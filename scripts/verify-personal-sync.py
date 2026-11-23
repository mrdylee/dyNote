"""Design experiment for personal vault sync, using only disposable local Git repos."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
NOTE = "회의록.md"
ARCHIVE = "자료.zip"


def git(repo, *args, allowed=(0,)):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
               GIT_TERMINAL_PROMPT="0", LC_ALL="C")
    result = subprocess.run(["git", "-C", str(repo), *map(str, args)],
                            capture_output=True, env=env)
    if result.returncode not in allowed:
        message = (result.stderr or result.stdout).decode(errors="replace")
        raise RuntimeError(f"{args}: {message}")
    return result


def revision(repo, ref="HEAD"):
    return git(repo, "rev-parse", ref).stdout.decode().strip()


def commit(repo, name, message):
    git(repo, "add", "-A")
    git(repo, "-c", f"user.name={name}", "-c", "user.email=test@example.invalid",
        "commit", "-m", message)
    return revision(repo)


def archive(parts):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as target:
        for name, content in parts.items():
            target.writestr(zipfile.ZipInfo(name), content)
    return stream.getvalue()


def workbook():
    ns = "http://schemas.openxmlformats.org/"
    sheet = ns + "spreadsheetml/2006/main"
    rel = ns + "officeDocument/2006/relationships"
    package = ns + "package/2006/relationships"
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml"
    return archive({
        "[Content_Types].xml": f'<Types xmlns="{ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="{mime}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="{mime}.worksheet+xml"/></Types>',
        "_rels/.rels": f'<Relationships xmlns="{package}"><Relationship Id="r1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{sheet}" xmlns:r="{rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="r1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{package}"><Relationship Id="r1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": f'<worksheet xmlns="{sheet}"><sheetData/></worksheet>',
    })


def versions_folder(repo, path):
    return repo / ".dynote-sync" / "conflicts" / hashlib.sha256(path.encode()).hexdigest()


def merge_in_isolation(remote, incoming, work):
    git(work.parent, "clone", remote, work)
    git(work, "fetch", incoming, "main")
    if git(work, "merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD", allowed=(0, 1)).returncode == 0:
        return
    changed = git(work, "diff", "--no-renames", "--name-only", "-z", "HEAD...FETCH_HEAD").stdout
    pending_edits = [name.decode() for name in changed.split(b"\0")
                     if name and versions_folder(work, name.decode()).is_dir()]
    merge = git(work, "-c", "user.name=integration", "-c", "user.email=test@example.invalid",
                "merge", "--no-ff", "--no-commit", "FETCH_HEAD", allowed=(0, 1))
    stages = {}
    for entry in git(work, "ls-files", "--unmerged", "-z").stdout.split(b"\0"):
        if entry:
            info, name = entry.split(b"\t", 1)
            mode, oid, stage = info.decode().split()
            if mode != "100644":
                raise ValueError("This experiment uses ordinary document files only")
            stages.setdefault(name.decode(), {})[stage] = oid
    if merge.returncode and not stages:
        raise RuntimeError(merge.stderr.decode(errors="replace"))

    # A later writer may share the published copy as its base. Git can then merge
    # cleanly even though a human still needs to choose a version of that path.
    for path in pending_edits:
        if path not in stages:
            stages[path] = {}
            for stage, ref in (("2", "HEAD"), ("3", "FETCH_HEAD")):
                entry = git(work, "ls-tree", "-z", ref, "--", path).stdout
                if entry:
                    stages[path][stage] = entry.split(b"\t", 1)[0].split()[2].decode()

    for path, blobs in stages.items():
        # Stage 2 is the published version because our scratch clone starts at the remote.
        folder = versions_folder(work, path)
        folder.mkdir(parents=True, exist_ok=True)
        for stage, ref in (("2", "HEAD"), ("3", "FETCH_HEAD")):
            oid = blobs.get(stage)
            source = git(work, "log", "-1", "--format=%H", ref, "--", path).stdout.decode().strip()
            record = folder / (source + ".json")
            if not record.exists():
                device = git(work, "show", "-s", "--format=%an", source).stdout.decode().strip()
                record.write_text(json.dumps({"path": path, "commit": source, "device": device, "blob": oid}),
                                  encoding="utf8")
            if oid:
                body = folder / (oid + ".blob")
                if not body.exists():
                    body.write_bytes(git(work, "cat-file", "blob", oid).stdout)
        if "2" in blobs:
            (work / path).write_bytes((folder / (blobs["2"] + ".blob")).read_bytes())
        else:
            (work / path).unlink(missing_ok=True)
    commit(work, "Integration", "integrate documents and preserve conflicting versions")
    git(work, "push", "origin", "main")


class PersonalSync(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="dynote-sync-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.remote = self.root / "remote.git"
        git(self.root, "init", "--bare", "--initial-branch=main", self.remote)
        self.cloud = self.clone("Cloud")
        (self.cloud / NOTE).write_text("회의 1시\n", encoding="utf8")
        (self.cloud / ARCHIVE).write_bytes(archive({"시간.txt": "1시"}))
        self.base = commit(self.cloud, "Cloud", "baseline")
        git(self.cloud, "push", "origin", "main")
        self.local = self.clone("Local")

    def clone(self, name):
        dest = self.root / name
        git(self.root, "clone", self.remote, dest)
        return dest

    def test_handoff_and_attachments(self):
        (self.cloud / NOTE).write_text("Cloud 초안\n", encoding="utf8")
        commit(self.cloud, "Cloud", "write note")
        git(self.cloud, "push", "origin", "main")
        git(self.local, "pull", "--ff-only")
        received = (self.local / NOTE).read_text(encoding="utf8")
        self.assertEqual(received, "Cloud 초안\n")
        (self.local / NOTE).write_text(received + "Local 추가\n", encoding="utf8")
        files = {"자료.zip": archive({"a.txt": "파일"}), "견적.xlsx": workbook(),
                 "발표.pptx": (FIXTURES / "office-preview.pptx").read_bytes(),
                 "안내.pdf": (FIXTURES / "link-target.pdf").read_bytes()}
        for path, data in files.items():
            (self.local / path).write_bytes(data)
        commit(self.local, "Local", "continue note and add attachments")
        git(self.local, "push", "origin", "main")
        for _ in range(2):
            git(self.cloud, "pull", "--ff-only")
        self.assertEqual((self.cloud / NOTE).read_text(encoding="utf8"), received + "Local 추가\n")
        for path, data in files.items():
            self.assertEqual((self.cloud / path).read_bytes(), data)
        self.assertEqual(revision(self.cloud), revision(self.local))
        self.assertEqual(git(self.remote, "rev-list", "--count", self.base + "..main").stdout, b"2\n")

    def test_three_writers_and_unrelated_notes(self):
        offline = self.clone("Offline")
        peers = [self.cloud, self.local, offline]
        versions = {path: {} for path in (NOTE, ARCHIVE)}
        for peer in peers:
            name = peer.name
            content = {NOTE: f"회의 {name}\n".encode(), ARCHIVE: archive({"시간.txt": name})}
            for path, data in content.items():
                (peer / path).write_bytes(data)
            (peer / (name + ".md")).write_text(name, encoding="utf8")
            source = commit(peer, name, name)
            for path, data in content.items():
                versions[path][name] = (source, data)
        git(self.cloud, "push", "origin", "main")
        for step, peer in enumerate(peers[1:], 1):
            rejection = git(peer, "push", "--porcelain", "origin", "main", allowed=(1,))
            self.assertIn(b"[rejected]", rejection.stdout)
            merge_in_isolation(self.remote, peer, self.root / f"integration-{step}")
            reader = self.clone(f"reader-{step}")
            for seen in peers[:step + 1]:
                self.assertEqual((reader / (seen.name + ".md")).read_text(), seen.name)
            for path in versions:
                self.assertEqual((reader / path).read_bytes(), versions[path]["Cloud"][1])
                observed = {}
                for record in versions_folder(reader, path).glob("*.json"):
                    metadata = json.loads(record.read_bytes())
                    self.assertEqual(metadata["path"], path)
                    data = (record.parent / (metadata["blob"] + ".blob")).read_bytes()
                    observed[metadata["device"]] = (metadata["commit"], data)
                self.assertEqual(observed, {p.name: versions[path][p.name] for p in peers[:step + 1]})
        tip = revision(self.remote)
        merge_in_isolation(self.remote, offline, self.root / "replay")
        self.assertEqual(revision(self.remote), tip)
        for peer in peers:
            git(peer, "pull", "--ff-only")
            self.assertEqual(revision(peer), tip)

    def test_restore_only_selected_file(self):
        (self.cloud / NOTE).write_text("새 회의록", encoding="utf8")
        latest = archive({"restore.txt": "유지"})
        (self.cloud / ARCHIVE).write_bytes(latest)
        before = commit(self.cloud, "Cloud", "update two files")
        git(self.cloud, "push", "origin", "main")
        git(self.local, "pull", "--ff-only")
        git(self.local, "restore", "--source", self.base, "--", NOTE)
        commit(self.local, "Local", "restore selected note")
        git(self.local, "push", "origin", "main")
        git(self.cloud, "pull", "--ff-only")
        self.assertEqual((self.cloud / NOTE).read_text(encoding="utf8"), "회의 1시\n")
        self.assertEqual((self.cloud / ARCHIVE).read_bytes(), latest)
        self.assertEqual(git(self.cloud, "show", before + ":" + NOTE).stdout, "새 회의록".encode())
        self.assertEqual(revision(self.cloud), revision(self.local))

    def test_late_edit_when_git_reports_clean_merge(self):
        (self.cloud / NOTE).write_text("오후 2시", encoding="utf8")
        commit(self.cloud, "Cloud", "set time")
        git(self.cloud, "push", "origin", "main")
        late = self.clone("Late")
        (self.local / NOTE).write_text("오후 3시", encoding="utf8")
        commit(self.local, "Local", "local time")
        merge_in_isolation(self.remote, self.local, self.root / "first-conflict")
        (late / NOTE).write_text("오후 4시", encoding="utf8")
        commit(late, "Late", "late time")
        merge_in_isolation(self.remote, late, self.root / "second-merge")
        reader = self.clone("reader")
        self.assertEqual((reader / NOTE).read_text(encoding="utf8"), "오후 2시")
        self.assertEqual({f.read_bytes().decode() for f in versions_folder(reader, NOTE).glob("*.blob")},
                         {"오후 2시", "오후 3시", "오후 4시"})

    def test_deletion_and_offline_edit(self):
        (self.cloud / ARCHIVE).unlink()
        commit(self.cloud, "Cloud", "remove archive")
        git(self.cloud, "push", "origin", "main")
        edited = archive({"오프라인.txt": "수정 보존"})
        (self.local / ARCHIVE).write_bytes(edited)
        commit(self.local, "Local", "edit before seeing delete")
        merge_in_isolation(self.remote, self.local, self.root / "delete-modify")
        reader = self.clone("reader")
        self.assertFalse((reader / ARCHIVE).exists())
        folder = versions_folder(reader, ARCHIVE)
        records = {item["device"]: item for f in folder.glob("*.json")
                   for item in [json.loads(f.read_bytes())]}
        self.assertEqual(set(records), {"Cloud", "Local"})
        self.assertIsNone(records["Cloud"]["blob"])
        self.assertEqual((folder / (records["Local"]["blob"] + ".blob")).read_bytes(), edited)


if __name__ == "__main__":
    unittest.main()
