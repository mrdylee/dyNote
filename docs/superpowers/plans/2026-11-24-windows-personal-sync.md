# Windows 개인 노트 동기화 구현 계획

> Superpowers executing-plans로 현재 체크아웃에서 순서대로 실행한다.

**목표** 기존 Windows 복제본에서 기기 등록과 파일 수신을 완료하고 소유권 오류를 발생 지점에서 설명한다.

**구조** core/git-backup.mjs의 Git 프로세스 결과와 core/personal-sync 계열의 디스크 비교를 수정한다. Electron 컨트롤러가 기존 보관함 화면에 상태를 전달한다.

**기술** Node.js, Git, Electron 및 node:test.

1. tests/git-backup.test.mjs에서 격리한 Git 설정과 GIT_TEST_ASSUME_DIFFERENT_OWNER로 저장소 검사를 실행한다. 기존 코드에서 검사 성공을 재현하고 수정 후 소유권 메시지와 경로를 확인한다.
2. tests/personal-sync-transport.test.mjs에서 양쪽 PC가 같은 문장을 고쳐 충돌 기록을 만든다. 세 번째 PC를 core.autocrlf=true로 체크아웃해 등록하고 원격 파일을 받는다. 원본 커밋의 사본과 실제 변경 감지를 확인한다.
3. core/personal-sync-store.mjs에서 Dynote가 생성한 텍스트 관리 경로를 식별한다. core/personal-sync.mjs와 core/personal-sync-disk.mjs의 전송 및 수신 검사에 같은 범위를 적용한다. 지원하지 않는 경로와 바이너리 변경은 기존 보호를 유지한다.
4. core/git-backup.mjs에서 로컬 저장소 소유권 진단을 허용된 종료 코드보다 먼저 판별한다. electron/git-controller.mjs에서 오류 문구를 전송 대기와 구분한다.
5. npm test와 git diff --check를 실행한다. Windows x64 패키지를 빌드하고 scripts/verify-release-package.mjs, ZIP 무결성 검사 및 패키지 소스 대조를 수행한다.
