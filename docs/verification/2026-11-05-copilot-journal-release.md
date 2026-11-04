# Copilot 저널 자동기록 리뷰와 v0.16.0 배포 검증

사용자의 “review 후 수정 후 배포” 요청에 따라 `a224f03`을 다시 리뷰했다. 기존의 무관한 수정과 미추적 문서는 배포 커밋에서 제외한다.

## 재현과 수정

1. 저널의 fenced 예시에 동일한 관리 marker가 있으면 단순 문자열 검사 때문에 실제 링크를 추가하지 않았다. 컨트롤러 회귀 테스트가 `0 !== 1`로 실패하는 것을 확인한 뒤 Markdown 관리 링크 범위 검사로 수정했다.
2. 관리 marker 안에 동일 링크의 fenced 예시를 적으면 실제 링크와 예시를 함께 세어 삭제가 누락되었다. 회귀 테스트의 문자열 비교 실패를 확인한 뒤 fenced/indented 코드 범위를 후보에서 제외했다. 사용자 예시는 그대로 남는다.

두 회귀 테스트를 포함한 수집 관련 21개 테스트가 수정 후 모두 통과했다.
## 배포 전 로컬 검증

- `npm test`: 416 통과, 0 실패, 0 skip.
- `npm audit --audit-level=moderate`: 취약점 0건.
- `npm run package:mac`: production build와 Mac arm64 패키징 성공. 기존 번들 크기 advisory만 출력했다.
- `verify-release-package.mjs darwin-arm64`: 소스·번들 283개 파일 일치, 필수 Copilot 런타임 포함, strict/deep ad-hoc 서명 검증 통과.
- `verify-copilot-journal.mjs`: 실제 패키지에서 11 checks, renderer error 0. 합성 source/profile/vault만 사용했다. 가져오기·새 세션 자동 반영·Live Preview·입력 보존·개별/묶음 삭제·undo·재시작 제외·개인/팀 경계를 확인했다.
- `git diff --check`와 새 release workflow의 YAML/branch/publish gate 검사 통과.

로컬 ASAR SHA-256: `90fd5f08e568cda11307e350ade94760bb23a94382067531a13a8635922b0b9f`.

## 공개 배포 검증 경계

새 `release/copilot-journal-v0.16.0` push workflow는 Mac arm64와 Windows x64 네이티브 테스트·보안 검사·패키지 비교·전체 UI 시나리오가 모두 통과해야 공개 베타를 게시한다. 각 플랫폼의 패키지 검증 JSON과 checksum 파일을 포함한다. 공개 뒤 전 자산을 다시 다운로드해 GitHub digest·checksum·archive·ASAR·Mac signature를 별도로 확인한다. 최종 기계 판독 결과는 `output/verification/v0160-public-release.json`에 기록한다.

이 커밋 시점에는 공개 파일 검증이 아직 수행되지 않았다. 실제 설치된 Dynote 앱, 사용자 VS Code 기록과 보관함은 수정하지 않았다. 기존 검증 문서의 무관한 수정과 미추적 파일은 포함하지 않았다.
