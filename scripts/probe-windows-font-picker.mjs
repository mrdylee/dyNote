import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { _electron: electron } = await import(pathToFileURL(path.join(process.env.RUNNER_TEMP,"dynote-ui-tools/node_modules/playwright/index.mjs")).href);
const fixture = await mkdtemp(path.join(tmpdir(),"dynote-font-layout-"));
const profile = path.join(fixture,"profile"), vault = path.join(fixture,"notes");
await mkdir(profile);
await mkdir(vault);
await writeFile(path.join(vault,"Home.md"),"# 글꼴 확인\n");
await writeFile(path.join(profile,"settings.json"),JSON.stringify({vaultRoot:vault}));
const app = await electron.launch({
  executablePath:path.resolve("release/v0.17.0/Dynote-win32-x64/Dynote.exe"),
  args:[],
  env:{...process.env,OPEN_NOTES_DATA:profile},
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1280,940));
  await page.getByRole("button",{name:"파일 목록",exact:true}).click();
  await page.locator('.file-row[title="Home.md"]').click();
  await page.getByRole("button",{name:"읽기 보기",exact:true}).click();
  await page.getByRole("button",{name:"설정",exact:true}).click();
  await page.getByRole("button",{name:"백업·복원",exact:true}).click();
  await page.getByRole("button",{name:"글꼴",exact:true}).click();
  await page.getByLabel(/^본문 글꼴 · /).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="본문 글꼴 선택"]')?.options.length > 10);
  const report = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="본문 글꼴 선택"]');
    const picker = list.closest("details");
    const rect = node => {
      const {width,height} = node.getBoundingClientRect();
      const {display,visibility,contentVisibility,appearance} = getComputedStyle(node);
      return {tag:node.tagName,width,height,display,visibility,contentVisibility,appearance};
    };
    const snapshot = () => ({
      open:picker.open,
      detailsContent:getComputedStyle(picker,"::details-content").contentVisibility,
      list:rect(list), search:rect(picker.querySelector("input")), summary:rect(picker.querySelector("summary")),
      picker:rect(picker), row:rect(picker.parentElement),
      options:list.options.length,
    });
    const baseline = snapshot();
    const style = document.createElement("style");
    document.head.append(style);
    style.textContent = ".font-picker[open]::details-content { content-visibility: visible; }";
    const explicitVisible = snapshot();
    style.textContent = ".font-picker select { appearance: none; }";
    const unthemedSelect = snapshot();
    style.textContent = "";
    const name = picker.getAttribute("name");
    picker.removeAttribute("name");
    picker.open = false;
    picker.open = true;
    const noGroup = snapshot();
    picker.setAttribute("name",name);
    const wrapper=document.createElement("div");
    list.before(wrapper);
    wrapper.append(list);
    const wrapped = snapshot();
    const plain=document.createElement("div");
    plain.className="font-picker";
    picker.after(plain);
    plain.append(list);
    const outsideDisclosure=rect(list);
    return {baseline, explicitVisible, unthemedSelect, noGroup, wrapped, outsideDisclosure};
  });
  console.log("WINDOWS FONT LAYOUT " + JSON.stringify(report));
} finally {
  await app.close();
  await rm(fixture,{recursive:true,force:true});
}
