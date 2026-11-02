# v0.14.0 공개 베타 배포 검증

[공개 릴리스](https://github.com/mrdylee/dyNote/releases/tag/v0.14.0)는 draft가 아닌 prerelease다. 태그와 릴리스 대상 커밋은 `2644736fabf08b973f646317ef6a29f8f639d5cd`로 일치한다. 기존 공개 태그·배포 파일은 교체하지 않았다.

## 네이티브 CI

[배포 실행 41461025574](https://github.com/mrdylee/dyNote/actions/runs/41461025574)의 Mac·Windows build와 publish가 모두 성공했다.

| 항목 | Mac arm64 | Windows x64 |
| --- | --- | --- |
| 단위 테스트 | 373 통과, 실패·건너뜀 0 | 371 통과, 실패 0, 건너뜀 2 |
| 전체 npm audit | 취약점 0 | 취약점 0 |
| 실제 패키지 검사 | 10개 시나리오 | 6개 시나리오 |
| 해당 실행기의 소스·번들·라이선스 비교 | 278개 바이트 일치 | 278개 바이트 일치 |

Windows의 건너뜀 2개는 Unix 쓰기 권한을 이용하는 기존 롤백 실패 주입 검사다. UI 검사는 개인·팀 폴더 분리, 용도 변경 보호, 실제 Git 원격/백업 대상, Git 관리·복원, AI 수정 검토 저장과 저널 계층을 포함한다. AI 응답은 결정적 fixture이며 실제 사용자 계정 로그인이나 유료 모델 추론을 수행하지 않았다.

첫 배포 실행은 Windows ASAR 검증 스크립트가 중첩 경로를 플랫폼 구분자로 정규화하지 않아 실패했다. 검증 스크립트를 수정한 새 커밋으로 양쪽 전체 CI를 재실행했고, 통과한 커밋만 게시했다. 실패한 실행에서는 릴리스가 게시되지 않았다.

## 공개 파일 재다운로드

다음 5개 파일을 실제 공개 URL에서 다시 받았다. GitHub asset digest와 파일 SHA-256, 두 체크섬 파일의 내용이 모두 일치했다.

| 파일 | SHA-256 |
| --- | --- |
| Dynote-0.14.0-macos-arm64.dmg | `0523b621d1c4c7deb7a0afc369fc30313161c4204ae77d39e91db0baf1dd259b` |
| Dynote-0.14.0-macos-arm64.zip | `f151392d1e3f5eb16d7046fe9d7991299ab3b3eca9bb96225906f33f005695f1` |
| Dynote-0.14.0-windows-x64.zip | `6573a87972e751d174ba32b114ba1108074db75bfb84ffd2cd5c262b65bcd407` |
| SHA256SUMS-macos-arm64.txt | `9fa0ffc4b3d985d6842dfa2ae626d5fe4be2ca535419d64d9832a783cd54b883` |
| SHA256SUMS-windows-x64.txt | `eb321482be548badf61f85f6c1ae902dc04563aaa7290b5dccc79c3e5130a5d2` |

- 두 ZIP 전체 CRC 검사 통과. 압축 경로 이탈 항목 없음.
- DMG checksum 검사 통과. 읽기 전용으로 마운트한 앱의 엄격한 deep codesign과 ASAR 해시 확인 후 마운트를 해제했다.
- 공개 ZIP의 Mac·Windows ASAR 해시가 각각 네이티브 CI에서 검증한 해시와 정확히 일치했다. Mac DMG 안의 ASAR도 Mac ZIP/CI와 같다.
- ASAR 내부 버전은 양쪽 모두 `0.14.0`, 실제 zod는 `4.6.6`이며 운영 의존성 metadata가 소스와 일치했다. 개발용 결과·테스트·문서는 제외됐다.
- Mac 공개 패키지는 로컬 소스·번들·라이선스 278개와 바이트 일치했다. Windows 공개 패키지는 210개가 바이트 일치하고, 67개는 checkout CRLF 차이만 있다. `dist/plugin.html` 1개에는 Windows 입력의 CR이 Vite HTML 변환 후 남은 차이가 있다. 해당 HTML의 CR만 제외하면 동일하며, 그 밖의 소스·번들·바이너리 차이는 없다. 네이티브 Windows CI 안에서는 278개 모두 runner checkout/build와 바이트 일치했다.
- 내려받아 압축을 푼 실제 Mac 앱에서 용도 덮어쓰기 보호와 Git 원격/백업 표시의 3개 UI 검사도 통과했다.

| 공개 패키지 | ASAR SHA-256 |
| --- | --- |
| Mac arm64 | `73dfd3328101b6c7b23c9676f3c4d3eeb67a7f051470f071a7512deb3f7432c9` |
| Windows x64 | `1becdbddeb82105024dd0adbebeeae02d65d7d3b71cba13ca66b04c48f25ad6f` |

## 범위와 설치 준비본

Mac은 ad-hoc 무결성 서명이며 Apple 공증·Developer ID 배포 서명은 없다. 일반 사용자의 Gatekeeper 기본 설정에서 바로 실행된다고 주장하지 않는다. 이 제한을 릴리스 노트와 DMG 설치 안내에 명시했다. Windows ARM·Intel Mac·Linux와 실제 계정의 AI 추론은 이번 실행 검증 범위가 아니다.

공개 ZIP에서 검증 후 복사한 설치 준비본:

`/Users/james_black/Applications/Dynote-updates/2026-11-02-v0.14.0/Dynote.app`

복사 후 서명·ASAR 해시도 다시 확인했다. 실제 `/Applications/Dynote.app` 교체와 사용자 문서·AI 계정·Git 설정 변경은 수행하지 않았다. 이전 v0.13.1 기반 로컬 준비본은 이 공개 v0.14.0 준비본으로 대체한다.

기계 판독 증거는 `output/verification/release-0.14.0-{ci,public-package,public-dmg,published,ready}.json`, 다운로드 원본·체크섬은 `/private/tmp/dynote-v0140-public/`에 있다. 다운로드·압축·DMG·실행 로그는 `/private/tmp/dynote-v0.14.0-public-*.log`에 남겼다.
