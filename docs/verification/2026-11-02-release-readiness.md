# 출시 준비 검토 — 2026-11-02

판정: 개발자 대상 베타로 쓸 만한 기능과 검증 근거는 있다. 현재 파일 그대로 안정판을 공개하는 것은 보류한다. 보안 의존성을 먼저 정리하고, 새 버전의 실제 배포 파일을 검증한 후 공개 베타를 권한다.

후속 수정: 아래 1번 의존성 항목은 [보안 의존성 수정·검증](2026-11-02-security-dependencies.md)으로 해결했다. 전체 audit 0건, 테스트 373개와 새 Mac 패키지 검사를 통과했다. 아래 내용은 최초 검토 당시의 상태이며, Apple 공증·이번 수정본의 Windows 검증·새 버전 배포는 계속 남아 있다.

## 검토 대상

- 소스: `81abfd94781f9fd9cd7b902614d13b75b07c7d4f`
- Mac 앱: `/Users/james_black/Applications/Dynote-updates/2026-11-02-personal-team-review-fixes/Dynote.app`
- ASAR SHA-256: `3a4147763b949239ba46a3abc271b0cf6395656274ad2d87e3de2b0ca1226c25`
- 공개 GitHub API 조회에서 최신 배포는 `v0.13.1`, prerelease이며 대상 소스는 `7bc410bbebf855084eff7ca295c0a8802550fe99`였다. 새 개인·팀 UI는 이 공개 파일에 포함되지 않았다.

## 이번 검토에서 재확인한 근거

- `npm test`: 370개 통과, 실패·취소·건너뜀 0.
- `npm run build`, `git diff --check`: 통과.
- 준비된 실제 Mac 패키지의 개인·팀, 리뷰 수정, 보관함·복원, Git, 저널 검사: 24개 항목 통과, renderer 오류 0.
- 별도 초기 프로필: 설정 파일이 없는 상태에서 AI 로그인 없이 저널 진입·즉시 입력·저장·재실행 확인. 처음 생성된 공간은 용도 미지정이며 기록 바이트가 유지됐다.
- 별도 저널 검사: 첫 입력과 기존 저널 이어쓰기, UTF-8/BOM/CRLF Markdown 9,438,761바이트 편집·저장·재실행 통과. AI 로그인 불필요.
- 준비된 앱의 소스·번들·라이선스 278개가 새 빌드와 바이트 일치. 개발용 결과·테스트·문서는 ASAR에서 제외됐다. `codesign --verify --deep --strict` 통과.

위 실행은 임시 프로필과 가상 문서를 사용했다. 실제 사용자 앱 교체나 사용자 계정의 유료 AI 요청은 수행하지 않았다. AI 서비스별 실제 계정 연결, 최신 Windows 실행, 장기간 운영 신뢰성을 이 검사로 주장하지 않는다.

## 공개 전 처리할 항목

1. **보안 의존성: 먼저 수정 또는 도달 가능성 평가가 필요하다.** `npm audit --omit=dev`는 High 2개를 보고했다. 두 보고는 Copilot SDK와 그 하위 `zod`에 연결된 하나의 advisory 경로다. SDK `1.0.23`이 `zod 4.3.6`을 고정하며, 실제 준비된 ASAR에도 같은 버전이 들어 있다. [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)는 큰 컬렉션 검증 시 메모리 고갈을 설명하며 수정 버전을 `4.6.6`으로 명시한다. Dynote에서 악용 경로를 재현한 것은 아니다. 호환되는 수정 의존성으로 교체한 뒤 AI·패키지 회귀 검사와 audit 재확인이 필요하다. audit가 제안한 SDK 하향 버전을 자동 적용하지 않았다.
2. **Mac 일반 사용자 설치: 서명·공증 보완이 필요하다.** 현재 서명은 ad-hoc이며 TeamIdentifier가 없다. 무결성 검사는 통과하지만 `spctl --assess --type execute`는 `rejected`를 반환했다. 일반 사용자에게 기본 보안 설정으로 설치·실행시키는 배포에는 Developer ID 서명·Apple 공증 후 내려받은 배포본의 실행 검증이 필요하다. 개발자 베타라면 이 설치 제약을 사전에 명시해야 한다.
3. **최신 Windows 검증: 아직 없다.** 공개 CI 성공은 `7bc410b`의 v0.13.1에 대한 것이다. `81abfd9`의 개인·팀 UI와 수정본은 Windows 네이티브 빌드·실행, 배포 ZIP 재다운로드·체크섬 검증을 거쳐야 한다. 그전에는 Mac에서 검증된 범위로만 배포를 한정해야 한다.
4. **새 버전으로 배포해야 한다.** 수정본의 package version은 아직 `0.13.1`이다. 기존 공개 태그·파일을 덮어쓰지 말고 새 버전과 변경사항, DMG/ZIP·체크섬을 함께 준비해야 한다. 최종 공개 파일이 검증한 소스와 일치하는지도 확인해야 한다.

## 대상 사용자와 안내 범위

Git을 이미 사용하는 개발자에게는 개인 저널과 팀 문서를 별도 폴더·저장소로 관리하는 흐름이 유용하다. 다만 팀 협업은 Git 기반이고, 자동 충돌 해결·실시간 공동 편집은 제공하지 않는다. Git 작업은 보관함 자체가 저장소 루트인 구성을 전제로 하며 코드 저장소의 docs 하위 폴더나 linked worktree를 지원한다고 안내하면 안 된다.

개인·팀 표시는 권한·저장소 공개 범위를 바꾸지 않는다. AI는 선택 사항이고 선택한 제공자만 연결하면 되며 Claude Code 로그인은 전체 앱 사용의 필수 조건이 아니다. Word·Excel 지원은 검토 단계로, 현재 제공 기능처럼 안내하면 안 된다.

## 증거 위치

- `/private/tmp/dynote-release-readiness-tests.log`
- `/private/tmp/dynote-release-readiness-build.log`
- `/private/tmp/dynote-release-readiness-native.log`
- `/private/tmp/dynote-release-readiness-first-run.log`
- `/private/tmp/dynote-release-readiness-journal-large.log`
- `/private/tmp/dynote-release-readiness-audit.json`
- `output/verification/release-readiness-first-run.json`

이번 검토는 소스·의존성·배포 준비 상태에 대한 평가이며 외부 push나 릴리스 게시는 수행하지 않았다.
