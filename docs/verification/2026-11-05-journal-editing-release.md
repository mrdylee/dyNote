# 저널 입력 수정 v0.16.1 배포 검증

사용자의 배포 요청에 따라 `a71029794e2cd37f602819074e0f622014213440`의 검토된 저널 수정과 Live Preview 기본 보기를 v0.16.1로 배포한다. 기존 `v0.16.0` 태그·자산은 변경하지 않는다. 무관한 수정·미추적 문서와 실제 사용자 데이터는 배포 커밋에서 제외한다.

## 소스 검토 범위

`src/journal-outline.mjs`, `src/Editor.jsx`, `src/styles.css`의 변경과 해당 회귀 검사·표준 native runner를 검토했다. 첫/빈 불릿의 Backspace, 하위 블록 보존, 빈 최상위 Enter, 느슨한 이미지 목록의 한 줄 Enter와 첨부 후 커서 위치·첫 행 정렬을 다룬다. 인용문 내부 목록은 일반 Markdown 처리로 유지한다. 기본 Live Preview는 기존 설정을 유지한다.

원본 앱과 이전 수정 단계의 재현·검증은 `2026-11-05-journal-logseq-editing.md`에 기록되어 있다. 이 문서는 후속 공개 배포 범위를 기록한다.

## 배포 게이트

새 `release/journal-editing-v0.16.1` workflow는 Mac arm64와 Windows x64의 전체 테스트, 보안 검사, 패키지 소스 비교와 native 검증이 모두 통과해야 공개 베타를 게시한다. native runner는 Mac 16종·Windows 12종 검증 스크립트이며 새 저널 입력·이미지 검사도 포함한다.

공개된 7개 파일을 다시 다운로드해 GitHub digest, checksum 목록, ZIP CRC, DMG checksum, 실제 ASAR와 CI 보고서, Mac strict/deep 서명을 별도로 확인한다. 최종 기계 판독 결과는 `output/verification/v0161-public-release.json`에 기록한다. 배포 커밋 시점에는 공개 파일 검증이 완료된 것으로 주장하지 않는다.

## 배포 전 로컬 결과

- `npm test`: 422 통과, 0 실패, 0 skip.
- `npm audit --audit-level=moderate`: 취약점 0건.
- v0.16.1 production build와 Mac arm64 패키징 통과. 기존 번들 크기 advisory만 출력했다.
- 새 native 저널 입력·이미지 검사: 9 checks, 0 failures, 0 renderer errors.
- `verify-release-package.mjs darwin-arm64`: 소스·번들 283개 파일 일치, 필수 런타임과 strict/deep ad-hoc 서명 검증 통과.

로컬 ASAR SHA-256: `5d3ec8d081a8546c896a79f35e4f8525eba4609dbf534852aa20f558288e7e89`.
