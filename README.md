# Dynote

REA로 설치된 Obsidian 1.12.7의 구조를 분석하고, 기능 명세를 바탕으로 독립 구현한 로컬 Markdown 데스크톱 앱입니다. 이전 이름은 Open Notes이며, 현재 구현에는 `JingHao-Leon/open-obsidian`의 코드를 사용하지 않았습니다.

## 실행

패키징 결과의 Apple Silicon Mac 앱:

`release/Dynote-darwin-arm64/Dynote.app`

Windows 64비트용 실행 폴더는 `release/Dynote-win32-x64/`입니다. 배포 ZIP의 **압축을 모두 푼 뒤**, 폴더 안의 `Dynote.exe`를 실행하세요. EXE 옆의 `resources`, DLL 등은 함께 있어야 합니다. 이 결과물은 Mac에서 교차 패키징하며 실제 Windows 실행은 아직 검증하지 않았습니다. [Windows 실행 안내](docs/WINDOWS.md)

GitHub 저장소에는 소스와 문서가 들어 있습니다. `release/` 실행 파일과 ZIP은 Git에 포함하지 않으며, 아래 명령으로 로컬에서 생성합니다.

앱을 열면 가상의 예제 문서가 나타납니다. 왼쪽 보관함 이름 옆 화살표로 **다른 폴더 열기**를 선택할 수 있습니다. 처음에는 실제 보관함의 복사본으로 확인하는 것을 권합니다.

개발 환경에서는 Node.js 22.12 이상과 npm을 준비합니다.

```sh
git clone https://github.com/mrdylee/dyNote.git
cd dyNote
npm ci
npm test
npm run build
npm start
```

`npm run dev`는 화면 개발 서버입니다. 파일 접근 기능은 Electron 앱에서만 제공하므로 실제 사용은 `npm start`로 실행합니다.

## 제공 기능

- 중첩 폴더의 `.md` 파일 열기, 새 문서 만들기, CodeMirror 기반 편집
- 읽기·편집·분할 보기, 자동 저장, 문서 탭
- 한글 전체 검색과 빠른 문서 전환 (`⌘/Ctrl K`, `⌘/Ctrl P`)
- `[[문서]]`, `[[경로/문서|표시 이름]]`, 제목 링크, 백링크
- 문서 연결 그래프: 이동, 확대/축소, 문서 클릭
- 개요와 태그, 변경 전 복구 사본, 외부 수정 충돌 감지
- 수동 저장 `⌘/Ctrl S`, 새 문서 `⌘/Ctrl N`

폴더를 바꾸거나 앱을 닫을 때도 저장 대기 중인 초안을 먼저 처리합니다. 저장에 실패하면 초안을 열린 창에 유지합니다. **초안은 앱 강제 종료나 프로세스 충돌까지 보존하는 별도 저장소는 아닙니다.** 저장 충돌 안내가 나오면 내용을 복사한 뒤 문서 새로고침을 선택하세요.

## 파일과 복구

원본 형식은 일반 UTF-8 Markdown입니다. 다른 앱의 숨김 설정 디렉터리와 첨부파일은 수정하지 않습니다. UTF-8 이외 인코딩과 8MB 초과 파일은 경고와 함께 제외합니다.

변경 전 복구 사본은 선택한 보관함 밖의 앱 데이터 폴더에 저장됩니다. 왼쪽 아래 방패 버튼 → **복구 사본 폴더 열기**로 찾을 수 있습니다.

기존 사용자의 설정·예제·복구 사본을 이어 쓰기 위해 내부 앱 데이터 폴더 이름은 `Open Notes`로 유지합니다. 앱의 표시 이름과 패키지 이름은 Dynote입니다.

- macOS: `~/Library/Application Support/Open Notes/recovery/`
- Windows: `%APPDATA%/Open Notes/recovery/`
- Linux: `$XDG_CONFIG_HOME/Open Notes/recovery/` 또는 `~/.config/Open Notes/recovery/`

복구 폴더는 보관함 ID와 문서 경로의 해시로 구분됩니다. 시간순 `.md` 파일을 열어 내용을 복사해 복구하세요. v0.1은 복구 파일을 자동 삭제하지 않으므로 장기간 사용하면 저장 공간을 확인해야 합니다. 파일은 평문이며 앱 자체 암호화는 제공하지 않습니다.

## 보안과 범위

문서 내용의 원시 HTML은 실행하지 않으며, 미리보기는 추가로 정제합니다. 화면은 Node.js 없이 격리된 환경에서 실행합니다. 파일 처리는 앱 본체의 정해진 기능만 사용합니다. 파일 경로 이탈, 숨김 경로, 심볼릭 링크 및 Windows 장치 이름을 거부합니다. 저장 전에 파일 내용의 해시를 비교하고 원본 사본을 만든 뒤 임시 파일을 교체합니다.

앱 내부의 HTTP/WebSocket 요청과 이미지 로딩은 차단합니다. 사용자가 외부 링크를 직접 클릭하면 허용된 웹/메일 주소만 운영체제의 브라우저나 메일 앱으로 엽니다. 이 경우에는 해당 외부 앱이 네트워크를 사용합니다.

플러그인 실행, ZIP 가져오기, 이미지 표시, 동기화, 모바일, Canvas, 기존 Obsidian 플러그인 호환, 이름 변경/삭제는 v0.1의 범위에 포함하지 않았습니다. Markdown 전체 규격 및 Obsidian의 모든 확장 문법과 동일하지 않습니다. 원자적 교체는 일반적인 중간 저장 손상을 줄이지만 전원 장애에 대한 디스크 내구성이나 악성 로컬 프로세스의 경로 교체 경쟁까지 보장하지 않습니다.

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

## 다음 개발 범위

이미지·PDF, 파일 이름 변경·이동·삭제와 링크 갱신, 링크 자동완성, 편집 영역 안의 Live Preview 등 데스크톱 기능을 다음 개발 대상으로 정했습니다. 아직 v0.1에 구현한 기능은 아닙니다. 모바일 연동과 Obsidian Sync/Publish 연동은 제외합니다.

노트 동기화는 사용자가 선택한 별도 노트 Git 저장소를 활용하는 방향입니다. 현재 앱 안에 Git 동기화 기능은 없습니다. 앱 소스 저장소에 개인 노트를 함께 올리지 않습니다. 참고 구현의 채택 여부와 Git 충돌·첨부파일 처리 조건은 [추가 기능 검토](docs/UPSTREAM-REVIEW.md)에 정리했습니다.
