# Mac v0.12.2 배포 검증

검증일: 2026-10-31. 대상: 사용자 Apple Silicon Mac, arm64.

앱 빌드 기준: `107be0c`(v0.12.2 제품 코드 `d3a2c51` 이후 Windows 검증 문서 추가). 이번 변경은 배포 스크립트·패키지 UI 검사 실행 경로·설치 문서이며 제품 실행 코드를 바꾸지 않는다. 패키징 후 갱신한 저장소 README는 앱에 포함된 README와 다를 수 있다.

## 실행 실패 원인

- 기존 `/Applications/Dynote.app` 0.6.1은 `codesign --verify --deep --strict`에서 `code has no resources but signature indicates they must be present`로 실패했다.
- 기존 사용자 Applications의 0.10.1은 무결성 검사는 통과했지만 `spctl --assess --type execute`는 거부했다. 번들 손상과 Apple 배포 신뢰는 서로 다른 문제다.
- 사용자가 Developer ID 인증서가 없다고 확인했다. 이번 배포는 adhoc 무결성 서명이며 Developer ID 서명·Apple 공증은 없다. Gatekeeper 허용이나 경고 없는 다운로드 실행을 주장하지 않는다.

## 패키지 및 기능 검증

- 전체 단위 테스트: 315 통과, 실패·건너뜀 0.
- `npm run package:mac`: 성공. 앱 버전 0.12.2, arm64 실행 파일, 엄격한 번들 서명 검증 통과.
- 실제 패키지 실행 파일로 `verify-ai-providers.mjs`, `verify-journal-workspace.mjs` 통과. 제공자 전환·취소·승인 후 저장과 최대 3문서 비교·저널 원본 보존·시작 화면·주간 업데이트 설정 확인. 격리된 테스트 프로필 사용, 실제 유료 추론 검증은 아님.
- DMG를 읽기 전용으로 마운트하고 ZIP을 새 임시 폴더로 압축 해제했다. 두 경로 모두 엄격한 번들 서명 검증과 실행 권한 확인 통과. DMG의 Applications 바로가기와 앱 버전 확인.
- `scripts/package-mac-distribution.mjs`는 검증된 앱으로 DMG, 업데이트 호환 ZIP, SHA-256 파일을 만든다. DMG에는 설치 및 공증 제한 안내를 포함한다.

로컬 설치에 사용한 파일(이후 GitHub CI에서 만든 공개 파일과는 별도):

| 파일 | 바이트 | SHA-256 |
|---|---:|---|
| Dynote-0.12.2-macos-arm64.dmg | 328199412 | c209ee00291608a09bb994af069544934dd15dd838c29a95bebcb36cf5df16f5 |
| Dynote-0.12.2-macos-arm64.zip | 289693316 | 62ca4753d2de661464fd444c12044f9dd9f1fbd2e965b1ea8da2e844496c8eb2 |

## 이 Mac 설치 및 실행

- 두 구버전을 사용자 Library의 `Dynote Install Backups/2026-10-31-mfcagezn`에 이동하여 보존했다.
- 검증된 ZIP에서 꺼낸 앱을 `/Applications/Dynote.app`에 설치했다. 설치된 앱도 엄격한 서명 검증 통과.
- macOS 앱 실행 경로로 정상 실행했다. 실제 프로세스 경로 `/Applications/Dynote.app/Contents/MacOS/Dynote`와 화면의 v0.12.2를 확인했다.
- 기존 `Open Notes` 사용자 데이터와 보관함 파일을 변경하지 않았다. quarantine 삭제나 전역 보안 설정 변경도 하지 않았다.
- 기존 설정은 이미 없는 임시 보관함을 가리켰다. 이후 사용자가 지정한 개인 보관함을 macOS 폴더 선택 창에서 선택했고 앱의 보관함 이름과 문서 목록 표시를 확인했다. 사용자는 테스트 용도로만 사용하도록 지정했다. 문서를 수정·이동하거나 AI에 전송하지 않았으며 개인 경로와 내용은 배포 파일·GitHub에 포함하지 않는다.

## 공개 배포

브라우저의 대용량 업로드가 대화 중단 시 닫혀 완료되지 않았다. 공개 Mac 자산이 없는 것을 확인하고 전용 `release/macos-v0.12.2` 브랜치의 GitHub macOS arm64 작업으로 전환했다. 이 환경은 공개 저장소 코드만 사용하며 개인 보관함에 접근할 수 없다. 제품 소스가 기존 v0.12.2 태그와 일치하는지 확인하고 전체 테스트, 패키징, ZIP에서 꺼낸 실제 앱의 UI 검사를 통과한 뒤 기존 Windows 자산을 보존하며 Mac 파일만 추가한다. 공개 파일의 해시는 로컬 빌드와 별도로 기록한다.

CI에서는 펼쳐진 긴 분류 미리보기 아래의 확인 버튼이 viewport 밖에 있어 UI 검사에서 중단됐고 게시 단계는 실행되지 않았다. 콘텐츠 크기 지정만으로는 CI에서 해결되지 않았다. 검증 스크립트는 미리보기 원문에 예상 내용이 있는지 확인한 뒤, 사용자가 클릭할 수 있는 제목을 눌러 미리보기를 접고 확인 버튼을 클릭한다. 강제 클릭이나 DOM 이벤트로 승인 동작을 우회하지 않는다. 로컬 배포 앱에서 이 흐름이 통과했다. 긴 미리보기는 화면 크기·글꼴에 따라 접어야 확인 버튼에 접근할 수 있는 배치 제한이 있으며, 제품 CSS는 이번 배포에서 변경하지 않았다.

최종 결과: [Mac 배포 작업 41199726365](https://github.com/mrdylee/dyNote/actions/runs/41199726365) 성공. 커밋 `629ced09771d024101c23494631e6e70029db691`. macOS arm64에서 단위 테스트 315개 통과(실패·건너뜀 0), DMG 검증, ZIP 추출 후 서명 검증, 실제 패키지의 AI·저널 화면 검사 통과. CI의 실제 콘텐츠 크기는 1280×700이었다. 명령 팔레트는 포커스에 의존하는 단축키 대신 실제 버튼으로 열었다.

[공개 릴리스](https://github.com/mrdylee/dyNote/releases/tag/v0.12.2)는 draft=false, prerelease=true이며 다음 Mac 파일을 포함한다.

| 공개 파일 | 바이트 | SHA-256 |
|---|---:|---|
| Dynote-0.12.2-macos-arm64.dmg | 330074023 | c45382813212c458f1ef43dffcadd30ba6bb8c158bda9b9b4a5d1c84fd7f7919 |
| Dynote-0.12.2-macos-arm64.zip | 291332663 | 02daea2cce19e2d645e19d56994e18a8e5e5d5ef3720e4ac50c320a95638d5f4 |
| SHA256SUMS-macos-arm64.txt | 192 | 8c12bdae617fd890b6c2e576915b72164be394c36be3096f42d34e935c5677a4 |

- 세 공개 파일을 다시 다운로드해 크기·SHA-256을 GitHub API 및 체크섬 파일과 대조했다. 모두 일치한다.
- 공개 DMG를 읽기 전용 마운트하고 ZIP을 새 폴더에 압축 해제했다. 양쪽 앱의 엄격한 서명 검사 통과, ZIP 실행 권한과 버전 0.12.2 확인, DMG와 ZIP의 ASAR 해시 일치.
- 공개 앱의 core/electron 파일 56개가 기존 v0.12.2 제품 소스와 바이트 단위로 일치한다. 개인 보관함 경로·폴더 항목과 테스트·문서·HANDOFF 파일은 패키지에 없다.
- 공개 ZIP에서 꺼낸 앱을 사용자 Mac의 격리된 임시 보관함에서 실행해 저널·3문서 비교·분류 원본 보존·설정 및 재시작 검사를 통과했다(1280×900, 화면 오류 0). 개인 보관함은 사용하지 않았다.
- Windows ZIP 자산 ID 692353362와 SHA-256, 체크섬 자산 ID 692353372가 그대로 유지됐다.
- 사용자에게 설치한 앱은 앞서 검증한 로컬 빌드이며 공개 CI 빌드와 동일한 v0.12.2 제품 소스다. 두 빌드의 압축 파일 해시는 별개다. 인터넷 다운로드의 Gatekeeper 승인이나 Apple 공증을 의미하지 않는다.
