# Dynote

REA로 설치된 Obsidian 1.12.7의 구조를 분석하고, 기능 명세를 바탕으로 독립 구현한 로컬 Markdown 데스크톱 앱입니다. 이전 이름은 Open Notes입니다. v0.2.0의 검색 색인은 MIT 라이선스의 `JingHao-Leon/open-obsidian` 코드를 재사용했습니다. [출처·라이선스](THIRD_PARTY_NOTICES.md)를 확인하세요.

v0.3.0은 Canvas·Bases 기본 기능과 새 그래프 엔진을 포함하는 프리릴리스입니다. [릴리스 검토·수정 기록](docs/RELEASE-REVIEW-0.3.0.md)을 확인하세요.

현재 개발 소스에는 [Live Preview 1단계](docs/LIVE-PREVIEW.md)가 추가되어 있습니다. 기존 v0.3.0 다운로드에는 포함되지 않으며, 아래 개발 실행 명령으로 확인할 수 있습니다.

## 실행

패키징 결과의 Apple Silicon Mac 앱:

`release/v0.3.0/Dynote-darwin-arm64/Dynote.app`

[그래프 기능·측정·검증 범위](docs/graph-validation.md)를 확인하세요.

Windows 64비트용 실행 폴더는 `release/v0.3.0/Dynote-win32-x64/`입니다. 배포 ZIP의 **압축을 모두 푼 뒤**, 폴더 안의 `Dynote.exe`를 실행하세요. EXE 옆의 `resources`, DLL 등은 함께 있어야 합니다. 이 결과물은 Mac에서 교차 패키징하며 실제 Windows 실행은 아직 검증하지 않았습니다. [Windows 실행 안내](docs/WINDOWS.md)

[GitHub Releases](https://github.com/mrdylee/dyNote/releases)에서 Mac Apple Silicon·Windows x64 ZIP과 SHA-256 파일을 받을 수 있습니다. Git 저장소에는 소스와 문서가 들어 있고 `release/` 실행 파일은 Git 이력에 포함하지 않습니다.

앱을 열면 가상의 예제 문서가 나타납니다. 왼쪽 보관함 이름 옆 화살표로 **다른 폴더 열기**를 선택할 수 있습니다. 처음에는 실제 보관함의 복사본으로 확인하는 것을 권합니다.

개발 환경에서는 Node.js 22.13 이상과 npm을 준비합니다.

```sh
git clone https://github.com/mrdylee/dyNote.git
cd dyNote
npm ci
npm test
npm run build
npm start
```

`npm run dev`는 그래프 WASM을 자동 생성한 뒤 화면 개발 서버를 시작합니다. 파일 접근 기능은 Electron 앱에서만 제공하므로 실제 사용은 `npm start`로 실행합니다.

## 제공 기능

- 중첩 폴더의 `.md` 파일 열기, 새 문서 만들기, CodeMirror 기반 편집
- 읽기·소스 편집·Live Preview·분할 보기, 자동 저장, 문서 탭
- 한글 전체 검색과 빠른 문서 전환 (`⌘/Ctrl K`, `⌘/Ctrl P`)
- `[[문서]]`, `[[경로/문서|표시 이름]]`, 제목 링크, 백링크
- 문서 연결 그래프: WASM·Worker 물리 배치, GPU 표시, 점 드래그, 이동·확대/축소, 문서 클릭
- 개요와 태그, 변경 전 복구 사본, 외부 수정 충돌 감지
- 수동 저장 `⌘/Ctrl S`, 새 문서 `⌘/Ctrl N`
- 로컬 PNG·JPEG·GIF·WebP 표시, 이미지 붙여넣기·파일 드롭·파일 선택으로 가져오기
- PDF 내장 보기·페이지 이동 (암호가 걸린 PDF와 PDF 편집은 지원하지 않음)
- 문서·첨부파일 이름 변경·폴더 이동, 연결 문서의 링크 갱신, 휴지통·바로 되돌리기
- `[[` 문서 자동완성, YAML 속성 편집·별칭·태그, 일반 Markdown 링크의 백링크 반영
- `"정확한 구문"`, `tag:시험`, `path:프로젝트/`, `-제외` 검색과 한국어 BM25 검색
- 체크박스 클릭 저장, 콜아웃·각주·수식·Mermaid, 순환·깊이를 제한한 문서 삽입
- 링크 없는 언급, 그래프의 경로·태그 필터와 현재 문서 주변의 연결 깊이
- Canvas 카드 편집과 Bases 기본 표·속성 편집: [사용법과 지원 범위](docs/CANVAS-BASES.md)

폴더를 바꾸거나 앱을 닫을 때도 저장 대기 중인 초안을 먼저 처리합니다. 저장에 실패하면 초안을 열린 창에 유지합니다. **초안은 앱 강제 종료나 프로세스 충돌까지 보존하는 별도 저장소는 아닙니다.** 저장 충돌 안내가 나오면 내용을 복사한 뒤 문서 새로고침을 선택하세요.

## 파일과 복구

원본 형식은 일반 UTF-8 Markdown입니다. 다른 앱의 숨김 설정 디렉터리는 읽거나 수정하지 않습니다. UTF-8 이외 인코딩과 8MB 초과 문서는 경고와 함께 제외합니다. 첨부파일은 25MB 이하의 PNG·JPEG·GIF·WebP·PDF를 지원하며 `_attachments/`로 바이트 그대로 복사합니다. SVG·HTML·실행 파일은 가져오지 않습니다.

상단 **이름·이동**에서 확장자를 유지한 새 경로를 입력합니다. 대상 파일이 있거나 문서가 외부에서 바뀌었다면 덮어쓰지 않습니다. 파일 이동·삭제 전에 저장 대기 중인 초안을 먼저 저장합니다. 이동에 실패하면 자체 변경을 복구하며 외부 변경은 덮어쓰지 않습니다. 휴지통 사본은 앱 데이터 `recovery/<vault-id>/trash/<item-id>/`에 보존합니다. 현재 실행 중에는 **되돌리기**, 재시작 후에는 복구 사본 폴더의 `entry.json` 경로와 `content` 파일로 복구할 수 있습니다.

편집 영역에서 이미지·PDF 파일을 붙여넣거나 드롭하면 링크를 삽입합니다. 파일 선택으로 가져오면 현재 문서 끝에 삽입합니다. **속성**에서는 YAML을 편집합니다. 잘못된 YAML이나 별칭 확장은 거부합니다.

변경 전 복구 사본은 선택한 보관함 밖의 앱 데이터 폴더에 저장됩니다. 왼쪽 아래 방패 버튼 → **복구 사본 폴더 열기**로 찾을 수 있습니다.

기존 사용자의 설정·예제·복구 사본을 이어 쓰기 위해 내부 앱 데이터 폴더 이름은 `Open Notes`로 유지합니다. 앱의 표시 이름과 패키지 이름은 Dynote입니다.

- macOS: `~/Library/Application Support/Open Notes/recovery/`
- Windows: `%APPDATA%/Open Notes/recovery/`
- Linux: `$XDG_CONFIG_HOME/Open Notes/recovery/` 또는 `~/.config/Open Notes/recovery/`

복구 폴더는 보관함 ID와 문서 경로의 해시로 구분됩니다. 시간순 `.md` 파일을 열어 내용을 복사해 복구하세요. 복구 파일은 자동 삭제하지 않으므로 장기간 사용하면 저장 공간을 확인해야 합니다. 파일은 평문이며 앱 자체 암호화는 제공하지 않습니다.

## 보안과 범위

문서 내용의 원시 HTML은 실행하지 않으며, 미리보기는 추가로 정제합니다. 화면은 Node.js 없이 격리된 환경에서 실행합니다. 파일 처리는 앱 본체의 정해진 기능만 사용합니다. 파일 경로 이탈, 숨김 경로, 심볼릭 링크 및 Windows 장치 이름을 거부합니다. 저장 전에 파일 내용의 해시를 비교하고 원본 사본을 만든 뒤 임시 파일을 교체합니다.

앱 내부의 HTTP/WebSocket 요청과 외부 이미지 로딩은 차단합니다. 보관함 안의 검증된 로컬 이미지만 별도 경로로 제공합니다. PDF는 검증한 바이트를 내장 뷰어로 읽습니다. 사용자가 외부 링크를 직접 클릭하면 허용된 웹/메일 주소만 운영체제의 브라우저나 메일 앱으로 엽니다. 이 경우에는 해당 외부 앱이 네트워크를 사용합니다.

플러그인 실행, ZIP 가져오기, 앱 내 Git 자동 동기화, 모바일, 기존 Obsidian 플러그인 호환은 지원하지 않습니다. Live Preview는 기본 서식·링크·체크박스·로컬 이미지부터 지원합니다. 표 셀 직접 편집, 수식·Mermaid·PDF·콜아웃의 편집 중 렌더링은 포함하지 않으며 읽기·분할 보기에서 기존 기능을 이용할 수 있습니다. Markdown 전체 규격 및 Obsidian의 모든 확장 문법과 동일하지 않습니다. 원자적 교체는 일반적인 중간 저장 손상을 줄이지만 전원 장애에 대한 디스크 내구성이나 악성 로컬 프로세스의 경로 교체 경쟁까지 보장하지 않습니다.

## 패키징

```sh
npm run package:mac
npm run package:win
npm run package:linux
```

공식 Electron Packager를 사용해 `release/`에 독립 실행 앱 디렉터리를 만듭니다. **Mac 앱과 Windows x64 실행 폴더를 생성했으며, 실행 검증은 macOS에서만 완료했습니다.** Linux는 패키징 명령만 제공합니다. 설치 마법사나 자동 업데이트는 없습니다. 결과물은 개발용으로 코드 서명하지 않았으며, macOS 공증도 진행하지 않았습니다.

## 검증과 분석 근거

`npm test`는 임시 실제 폴더와 가상 문서를 사용합니다. 기존 개인 보관함은 검증에 사용하지 않았습니다. 경로 이탈·심볼릭 링크·충돌·복구 바이트·편집 중 저장·미리보기 입력·문서 관계를 시험합니다. 전체 의존성 검사는 `npm audit`로 다시 실행할 수 있습니다. 2026-10-19 검증 결과는 `docs/VERIFICATION.md`에 기록했습니다.

REA의 관찰 범위와 한계: [REA 분석 기록](docs/REA-EVIDENCE.md). Electron의 [보안 지침](https://www.electronjs.org/docs/latest/tutorial/security)과 [컨텍스트 격리 지침](https://www.electronjs.org/docs/latest/tutorial/context-isolation)을 참고했습니다.

이 프로젝트는 Obsidian과 별개로 제작한 실험 앱이며, Obsidian의 소스·스타일·로고·번들 자산을 배포하지 않습니다.

## Git으로 노트 동기화

앱 소스 저장소와 개인 노트 저장소를 분리합니다. 별도 노트 저장소를 Git으로 복제한 뒤 Dynote에서 그 폴더를 엽니다. 앱에 자격 증명을 저장하거나 백그라운드에서 노트를 업로드하는 기능은 없습니다.

1. 편집 전 저장을 마치고 Git 도구에서 `git pull --ff-only`를 실행합니다.
2. 변경 사항을 가져온 뒤 Dynote의 **문서 새로고침**을 선택합니다. 실시간 외부 파일 감시는 아직 없습니다.
3. 편집 후 저장 완료를 확인하고, 노트 저장소에서 변경 파일을 검토한 뒤 커밋·푸시합니다.
4. 분기 이력이 갈라지거나 충돌이 있으면 Git 도구에서 먼저 해결합니다. 바이너리 첨부파일의 충돌에서는 두 사본을 모두 보존한 뒤 선택합니다. Dynote는 충돌을 자동 폐기하지 않습니다.

Canvas·Bases는 v0.3.0에서 기본 기능을 구현했습니다. Obsidian 플러그인 호환은 별도 설계 항목으로 남아 있습니다. 원본과의 전체 호환성이나 대규모 보관함 성능을 보장하지 않습니다. [참고 코드 검토](docs/UPSTREAM-REVIEW.md), [v0.2.0 검증](docs/VERIFICATION.md)을 확인하세요.
