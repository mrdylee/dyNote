# Dynote v0.5.0 — Copilot 실시간 문서 작업과 일일 백업

## 주요 변경

- 오른쪽 Copilot 패널에서 GitHub 계정으로 연결하고 사용 가능한 모델을 선택합니다. Ask·Edit·Agent 모드, 문서·선택 영역 전달, 참고 문서 첨부를 지원합니다.
- Agent의 수정 작업이 끝날 때마다 가운데 문서에 바로 반영하고 변경 줄을 초록색으로 표시합니다. 글자 단위가 아닌 완료된 도구 작업 단위로 반영됩니다.
- **변경 유지**로 파일에 저장하거나 **변경 되돌리기**로 취소합니다. 중지·오류·앱 재실행 후에도 미확정 초안을 복구합니다. 직접 편집하거나 외부 파일이 변경되면 덮어쓰기를 방지하고 별도 복구본을 저장할 수 있습니다.
- Enter로 전송하고 Shift+Enter로 줄을 바꿉니다. 입력란 아래 작은 모드·모델 선택기와 채팅의 Markdown 표·Mermaid 표시를 지원합니다.
- 설정에서 보관함·글꼴·Git 백업·날짜별 복원을 관리합니다. 선택한 보관함은 앱 업데이트 후에도 유지됩니다.
- Git은 현지 시간 밤 11시 하루 한 번 백업하며 놓친 일정은 다음 실행 때 처리합니다. 변경이 없으면 커밋을 만들지 않습니다. 로컬 자동 저장은 계속 동작합니다.
- Git 캘린더에서 백업 날짜를 고르고 변경 내용을 확인한 뒤 복원합니다. 복원 전 현재 파일의 복구 사본을 남깁니다.
- Codex 연결은 제거했습니다.

## 다운로드 및 설치

- **Mac Apple Silicon**: `Dynote-0.5.0-mac-arm64.zip`을 풀고 `Dynote.app`을 응용 프로그램 폴더에 넣습니다. 기존 앱은 종료한 뒤 교체하세요.
- **Windows x64**: `Dynote-0.5.0-windows-x64.zip`을 전부 풀고 `Dynote-win32-x64/Dynote.exe`를 실행합니다. DLL·resources를 포함한 폴더 전체가 필요합니다.
- `SHA256SUMS.txt`로 다운로드 무결성을 확인할 수 있습니다.

## 검증과 제한

- 단위 테스트 145개, Mac 패키지의 실시간 편집 13개 시나리오, 기존 Ask/Edit·첨부·입력·Mermaid 동작을 검증했습니다. 실제 Copilot Auto 모델의 연속 수정 도구 호출도 가상 문서로 확인했습니다.
- Windows 패키지는 macOS에서 교차 생성했습니다. **Windows 실제 실행·키체인/자격 증명 관리자·한글 IME는 미검증**입니다.
- 배포 서명·macOS 공증·설치 마법사·자동 업데이트는 제공하지 않는 프리릴리스입니다.
- Copilot은 해당 계정의 사용량·조직 정책을 따르며 선택한 문서와 대화가 GitHub Copilot으로 전송됩니다. 미확정 초안은 로컬 앱 데이터에 보관되며 Git 백업에는 유지한 파일만 들어갑니다.
- Git 백업은 자동 pull·양방향 동기화·충돌 병합을 하지 않습니다. 기존 Git 설치와 저장소 인증이 필요합니다.

[Copilot 사용 안내](https://github.com/mrdylee/dyNote/blob/v0.5.0/docs/COPILOT.md) · [설정·Git 백업 안내](https://github.com/mrdylee/dyNote/blob/v0.5.0/docs/FONTS-GIT.md) · [실시간 편집 검증](https://github.com/mrdylee/dyNote/blob/v0.5.0/docs/verification/copilot-live-edits-review.md)
