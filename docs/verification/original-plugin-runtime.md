# 원본 Obsidian 플러그인 실행 검증

2026-10-28 · v0.8.0 프리릴리스의 원본 플러그인 호스트. v0.7.0에는 포함되지 않은 변경입니다.

사용자가 REA로 Obsidian 플러그인을 검토해 가져오도록 요청하고, **원본 플러그인 실행 지원 추가**를 선택했습니다. Recent Files 1.7.10과 Calendar 1.5.10을 실제 다운로드 원본 그대로 실행하도록 연결했습니다. 기존 11개 네이티브 대응 기능이나 모든 Obsidian 플러그인의 완전한 호환을 뜻하지 않습니다.

## REA에서 확인한 근거

| 대상 | REA 분석 Evidence | 확인한 범위 |
|---|---|---|
| Obsidian 1.14.5 ASAR의 app.js | `ev_08c14f3c59b2c82c17dff87814b594292c2bb177f664700ff0858093a1f153e1` | 플러그인 manifest/main.js 읽기, CommonJS require/module/exports 연결, Plugin 생성·load·CSS·unload 흐름 |
| Recent Files 다운로드 | `ev_b59a17350330254b5d7e594a9d563d66b8ebb50e772450b9d3374d602f5ca6ae` | 명령·화면·파일 열기/수정 이벤트·원본 설정과 데이터 저장 요구 |
| Calendar 다운로드 | `ev_6ff013a64bd22fa534fb0348ba1819d8bda444ba6491d6e8e1359715f0203822` | ItemView, 파일/폴더 모델, Moment, 날짜 클릭·확인창·새 노트 생성·원본 설정 요구 |

Obsidian ASAR SHA256: `3a349274f789b62c5b35ad19de10311909a94e8783033569c2210a4bac491780`. 파싱 실패는 0이지만, Obsidian에서는 app.js만 선택했고 의미 그래프는 크기 제한으로 **부분 분석**입니다. 정적 분석만으로 실행 성공을 주장하지 않았으며 아래 별도 실제 실행을 수행했습니다. 원본 코드 문맥은 ignored `output/research/rea-plugin-import/loader-source-contexts.json`, 전체 REA Evidence는 같은 폴더의 `evidence.json`에 보존했습니다. Obsidian app.js를 제품에 복사하지 않았습니다.

다운로드 출처: [Recent Files 1.7.10](https://github.com/tgrosinger/recent-files-obsidian/releases/tag/1.7.10), [Calendar 1.5.10](https://github.com/liamcain/obsidian-calendar-plugin/releases/tag/1.5.10). Calendar 2.0 베타는 다운로드만 했으며 이 지원 대상에서 제외했습니다.

## 구현한 연결

설정 → 플러그인에서 manifest.json/main.js가 있는 로컬 폴더를 가져온 뒤 켭니다. styles.css가 있으면 함께 읽으며 프로그램 바이트는 변경하지 않습니다. 기존 개인 data.json은 읽거나 복사하지 않습니다. 설치·켜짐 상태·원본 데이터는 앱 데이터 디렉터리의 plugins 아래 저장하고 보관함 ID로 분리합니다.

플러그인마다 별도 sandbox/context-isolation 창과 보관함별 독립 origin을 사용합니다. eval은 이 실행 창의 CSP에서만 허용하며 메인 문서의 CSP는 유지했습니다. 원본 모듈에는 독립 구현한 obsidian API와 moment만 제공합니다. 플러그인 창에는 Node와 메인 앱 bridge가 없고, 호스트 요청은 자신의 창·메인 프레임·보관함 ID를 확인합니다. 파일 생성은 기존 Vault.create를 사용해 경로 검사와 기존 파일 덮어쓰기 거부를 유지합니다. 종료 시 원본 unload를 요청한 뒤 실행 창을 정리합니다. 창 닫기는 숨기기이고, 실제 종료는 설정의 끄기입니다.

기본 문서·명령 팔레트는 유지하고, 플러그인이 등록한 명령을 추가 표시합니다. 파일을 열면 원본 Recent Files에 이벤트를 전달하며, 원본 목록의 클릭은 Dynote 문서를 엽니다. Calendar는 실제 원본 Svelte UI와 확인창을 사용해 기존 날짜를 열거나 새 Markdown 파일을 만듭니다. 기본 일간 노트 경로/파일명/템플릿 설정도 현재 보관함의 native 설정에서 전달합니다.

## 실제 실행 결과

동일한 검사를 소스 앱과 새 macOS arm64 패키지에서 각각 수행했습니다. 프로그램 이외의 OS 선택창만 테스트 폴더로 지정했으며 실제 원본 플러그인 코드·화면·명령·설정·파일 저장을 실행했습니다.

- 폴더 가져오기 → 원본 main.js 로딩 → 원본 화면 생성.
- Recent Files: Alpha/Beta 열기 순서 기록, 디스크 저장, 원본 제외 규칙 적용, 원본 행 클릭으로 Dynote 문서 열기.
- 원본 명령이 Dynote 명령 팔레트에 표시되고 실행됨.
- Calendar: 원본 달력 표시, 2026-10-15 기존 문서 열기, 2026-10-28 원본 확인창에서 Create 클릭 후 실제 파일 생성. 기존 문서 바이트 유지.
- 끄기: 원본 unload와 창 정리, 명령 제거. 켜기: 다시 로딩.
- 앱 재시작: 두 플러그인 켜짐 상태와 원본 설정 복원.
- 다른 보관함 전환: 이전 실행 창 종료, 기본 꺼짐 상태, 제외 규칙과 최근 기록 분리.
- 지원하지 않는 node:fs import: 성공으로 표시하지 않고 명시적 실행 오류.
- 플러그인 창에서 Node/메인 bridge/메인 localStorage 접근 불가. 미지원 호스트 요청 거부.
- 저장된 manifest/main.js SHA256과 다운로드 원본 일치.

소스 실행 기록: `output/playwright/original-plugins/runtime.json`.
패키지 실행 기록: `output/playwright/original-plugins-packaged/runtime.json`.
스크린샷은 각 폴더의 calendar.png, recent-settings.png, calendar-created.png입니다.

전체 자동 검사 **218개 통과, 실패/건너뜀 0**, 프로덕션 빌드 성공. 추가 검사에는 경로 탈출·프로그램 심볼릭 링크 거부, 보관함별 저장, 다른 프레임/오래된 보관함 요청 거부, unload 시 명령 제거가 포함됩니다. 활성 플러그인이 없는 보관함은 추가 전체 snapshot을 만들지 않는 것도 검사했습니다. 기존 큰 번들 경고는 남아 있습니다.

## 지원 경계

검증 대상은 위 두 버전의 대표 Markdown 동작입니다. Markdown 외 첨부파일 추적, 문서 hover, 원본 드래그, 파일 컨텍스트 삭제, native 북마크 제외, 다른 플러그인과의 상호작용, Node·셸·외부 네트워크, Obsidian 전체 editor/workspace API는 지원 또는 검증 범위가 아닙니다. 일부 원본 메뉴는 이런 미연결 API를 요청하면 오류가 날 수 있습니다. Calendar의 기존 모든 설정 조합과 모든 명령 의미가 검증된 것은 아닙니다.

Windows 런타임, 기존 공개 v0.7.0 업데이트 경로, 서명·공증은 검증하지 않았습니다. v0.8.0 배포 패키지와 게시 결과는 [릴리스 검증](release-0.8.0.md)에 기록합니다. 제3자 플러그인 프로그램은 패키지에 포함하지 않습니다.
