# Logseq 데스크톱 비교와 저널 입력·이미지 수정

2026-11-05. 사용자 요청: 현재 불릿을 알아볼 수 있는 강조, Backspace 시 불릿 보존, 이미지 뒤 Enter가 두 줄씩 증가하는 증상과 관련 편집 차이를 검토·수정한다.

## 실제 비교 대상과 격리

공식 [Logseq 2.0.2 데스크톱 배포본](https://github.com/logseq/logseq/releases/tag/2.0.2)의 Mac arm64 ZIP을 내려받았다. DB Beta Testing 릴리스이며 이전 파일 기반 버전 전체와 동일하다고 추정하지 않는다.

ZIP 크기 171440323 bytes. SHA-256 `ffd6e086ba6f68a4748f80eaa8b38244a9cf78b05c076343d75e0230fe9440b4`가 GitHub 공개 digest와 일치하고 ZIP CRC를 통과했다. 실제 앱의 ASAR SHA-256은 `aac5f9e5af43837157c9f3b576752d156cca086e43fae23acf2a2e3e566c8b6d`다.

공식 앱과 그 Electron 42.3.0을 별도 폴더에서 실행했다. Inspector의 첫 진입점에서 앱의 home·appData·userData·sessionData를 임시 폴더로 지정하고 `LOGSEQ_GRAPHS_DIR`도 임시 그래프 폴더로 지정했다. HOME 환경변수와 기존 사용자 보관함·설정은 변경하지 않았다. 기본 프로토콜 등록만 테스트 실행에서 비활성화했고 제품의 편집 코드는 변경하지 않았다. Demo 그래프에 합성 문장과 공개 이미지 URL만 입력했다. 관찰 종료 후 앱을 종료했다.

## REA 근거와 실행 범위

- 실제 Electron fuse: `ev_1aea96602f13d02fc7ce98968f0c13b8646b45ec936ffa270fc5625bdadb0213`. Node CLI Inspector 사용 가능 상태를 확인했다. fuse 상태만으로 앱의 실행 결과를 추정하지 않는다.
- ASAR 분석 summary: `ev_5e6a12931dbffc364a4973c5032b52484ae820cd8d28219e062b6a20bcc3a550`.
- ASAR 분석 parent: `ev_ab3840a9b162abb8ccd63a68a7d81519a9468e9e734a65be7cf78c5029fe5cde`. `package.json`, `electron.js`만 선택했다. 다른 파일 관계와 제한된 semantic graph는 unknown으로 유지했다. CSS 규칙은 배포본에서 직접 읽고 실제 창에서 별도로 측정했다.
- 공식 ZIP과 일치하지만 ASAR의 unpacked zvec/keytar native companion 선언 해시와 파일 해시가 다르다. 최초 분석은 이를 거부했다. record-and-continue로 두 항목을 명시적으로 untrusted로 남겨 제한된 정적 관찰만 보존했다. 해당 바인딩의 무결성·보안 결론은 내리지 않는다.
- REA의 file 페이지 발견 도구는 이번 앱의 `lsp://logseq.com/index.html`을 지원하지 않아 renderer를 반환하지 않았다. 실제 앱의 키보드 입력·스타일·화면 측정은 Playwright CDP로 수행했다. REA가 데스크톱 키 입력을 실행했다고 표현하지 않는다.
- 초기 공식 웹앱 비교 `ev_265186dddb4c93839e3776b0134f9d27c785958779ef38253960b198fb92bca2`는 보조 자료다. 데스크톱 동작 판단은 이후 실제 앱 관찰을 기준으로 한다.

Portable REA bundle과 native 관찰 기록: `output/verification/logseq-desktop-review/`. 실제 앱 관찰의 원본 테스트 절차와 격리 런처는 `/private/tmp/dynote-logseq-desktop-review/`에 보관했다.

## 확인한 동작과 수정

1. 실제 Logseq의 불릿 hover는 6.3984px에서 7.6781px로 1.2배 확대된다. 입력 커서의 기본 크기는 그대로다. Dynote에는 사용자가 요청한 현재 위치 식별을 위해 hover와 입력 중인 불릿 모두에 같은 1.2배 강조를 적용했다. 기본 6px 원, 제목 정렬과 들여쓰기·연결선 기준점은 유지한다.
2. 실제 Logseq는 첫 블록 시작점의 Backspace를 소비하고, 빈 다음 블록은 이전 블록과 합친다. 첫 하위 블록 시작점에서는 본문을 부모와 합치며 커서를 합친 경계에 둔다. Dynote의 첫 빈 불릿 삭제와 빈 연속 줄 잔류를 재현한 뒤 이 흐름을 추가했다. 하위 블록·형제와 한 번의 undo를 테스트한다.
3. 실제 Logseq는 빈 최상위 블록에서 Enter로 다음 빈 블록을 만들고 빈 하위 블록에서는 상위 단계로 돌아온다. Dynote의 빈 최상위 Enter가 불릿을 제거하는 차이도 수정했다.
4. 이미지가 있는 느슨한 Markdown 목록에서 CodeMirror의 기본 목록 Enter가 빈 줄까지 반복해 `After image\n\n- Second line\n\n- Third line`이 되는 증상을 실제 Dynote 기준 앱에서 재현했다. 저널 Enter는 기존 빈 줄을 임의로 지우지 않고 새 블록을 한 줄씩 추가한다.
5. 이미지 붙여넣기 후 커서가 삽입 이미지 앞에 남아 다음 입력이 이미지 앞에 들어가는 문제도 재현했다. 저널에서는 이미지 불릿과 다음 불릿을 만들고 입력 커서를 그 다음 불릿에 둔다. 일반 문서의 첨부 삽입도 커서를 삽입 결과 뒤로 명시한다.
6. 실제 Logseq는 이미지 블록의 첫 행 높이에 불릿을 표시한다. Dynote는 이미지 중앙에 놓고 있었다. native 회귀에서 27.75px 행의 불릿 중심이 58.4453px 아래에 있어 실패하는 것을 확인했다. 이미지가 있는 저널 행의 불릿 컨테이너를 상속된 한 행 높이에 맞춰 상단 정렬했다.
7. 리뷰에서 인용문 안의 목록이 새 저널 Enter·첨부 처리를 받는 경우를 재현했다. 시각적 저널 범위와 같이 들여쓰기만 있는 목록에 적용하고 인용문은 일반 Markdown 처리로 넘긴다. 일반 문서의 일반 구간, YAML·코드·read-only·IME 보호와 기존 링크 자동완성도 확인한다.

## 검증

최종 JavaScript 변경 후 `npm test`: **422 통과, 0 실패, 0 skip**. 최종 CSS 정렬은 실제 앱의 시각적 검증으로 확인한다. production build는 성공했으며 기존 번들 크기 advisory가 남는다.

새 `scripts/verify-journal-logseq-editing.mjs`는 불릿 확대, 첫 빈 불릿 Backspace, 빈 형제 합치기, 빈 최상위 Enter, 실제 이미지 붙여넣기·커서·다음 세 줄, 기존 이미지 목록의 한 줄 Enter, 이미지 불릿 첫 행 정렬과 renderer 오류를 검사한다. 합성 이미지와 임시 profile/vault만 사용한다. 표준 `verify-journal-release.mjs`에도 이 검사를 포함했다.

확인용 Mac 앱: `output/journal-logseq-build/Dynote-darwin-arm64/Dynote.app`. 앱 버전 번호는 기존 0.16.0 기반 로컬 확인판이다. 공개 v0.16.0 파일을 교체하거나 새 버전을 배포하지 않았다. 설치된 Dynote와 실제 노트·계정은 변경하지 않았다. Windows native 실행은 이 작업에서 수행하지 않았다.

최종 실행 결과:

- 새 native 입력·이미지 검사: **9 checks, 0 failures, 0 renderer errors**.
- 이미지 불릿 중심: 행 시작에서 **13.875px**, 행 높이 **27.75px**로 첫 행 중앙에 일치한다.
- 기존 저널 outline·threading·구간 편집·editor tools·Copilot 저널을 포함한 **6종 native 검증 스크립트 모두 통과**.
- 소스·번들 **283개 파일 일치**, 필수 Copilot 런타임 포함 및 strict/deep ad-hoc 서명 검증 통과.

ASAR SHA-256: `f139aa2ca155c391130ca847bd904d5f2467d17b1b4ae5e4acbe6af79879b94a`.

기계 판독 결과: `output/verification/journal-logseq-final.json`, `output/verification/journal-logseq-package.json`, `output/playwright/journal-logseq-editing/report.json`.

후속 v0.16.1 배포 검증은 [배포 기록](2026-11-05-journal-editing-release.md)에 별도로 기록한다. 위의 로컬 확인판 경계는 이 문서의 수정 단계 실행 시점이다.
