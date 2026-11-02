# 보안 의존성 수정 — 2026-11-02

출시 검토의 의존성 항목을 수정했다. Copilot SDK와 앱 기능은 유지하고, 취약한 하위 의존성과 Electron의 보안 수정 버전을 적용했다. 외부 push·릴리스 게시·실제 사용자 앱 교체는 수행하지 않았다.

후속 배포: 이 수정은 [v0.14.0 공개 베타](release-0.14.0.md)에 포함됐다. 양쪽 네이티브 CI와 공개 파일 재다운로드 검증까지 완료했으며, 아래 내용은 의존성 수정 단계 당시의 기록이다. 실제 사용자 앱 교체는 수행하지 않았다.

## 변경

| 대상 | 이전 | 수정 | 적용 범위 |
| --- | --- | --- | --- |
| zod | 4.3.6 | 4.6.6 | `@github/copilot-sdk` 하위 override |
| Electron | 44.9.0 | 44.9.1 | 개발·패키지 실행 엔진 |
| glob | 13.0.6 | 14.0.2 | `@electron/asar` 하위 override |
| minimatch | 10.2.6 | 11.0.1 | `@electron/asar` 하위 override |

Copilot SDK는 `1.0.23`, 네이티브 Copilot 런타임은 `1.0.100`을 유지했다. 조회 당시 최신 SDK `1.0.28`도 zod `4.3.6`을 고정하므로 SDK 업데이트만으로 해결되지 않았다. 앱 전체의 무관한 의존성을 갱신하지 않고 override 범위를 해당 상위 패키지로 제한했다. glob 변경에 필요한 path-scurry 및 minimatch의 새 하위 의존성도 잠금 파일에 반영됐다.

공식 근거:

- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [상위 크기 제한을 먼저 검사하는 수정](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)
- [Electron advisory](https://github.com/advisories/GHSA-jr5w-w6x2-84p9), [44.9.1 보안 수정 릴리스](https://github.com/electron/electron/releases/tag/v44.9.1)
- [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## 검증

- 변경 전 운영 의존성 audit: High 2개, Copilot SDK → zod의 같은 advisory 경로.
- zod만 수정한 뒤 전체 audit를 넓혀 Electron High 1개와 패키징 도구 경로 Moderate 5개도 확인했다. Electron은 devDependency로 선언되어 있어도 실제 배포 엔진이므로 수정했다.
- 최종 `npm audit`: 운영·개발 의존성 전체 **0건**, 종료 코드 0. 이는 해당 시점 audit DB 기준이며 앱 전체에 취약점이 없다는 보장은 아니다.
- `npm ci --no-audit --no-fund` 재설치 후 **373개 테스트 통과**, 실패·취소·건너뜀 0.
- 새 회귀 검사 3개는 SDK 위치에서 실제 zod를 찾아 배열·집합·맵 크기 초과를 검사한다. 구버전에서 모두 실패했으며, 수정 후 원소별 오류를 누적하지 않고 크기 오류 하나로 거부한다. 정상 입력 결과도 보존한다.
- 실제 네이티브 SDK의 선택 MCP·스킬·리소스 경계 및 수정안 유지 검사 3개 통과. 실제 계정 로그인이나 유료 추론은 사용하지 않았다.
- `npm run package:mac` 성공. glob/minimatch 변경을 적용한 ASAR 생성·바이너리 unpack·패키지 실행을 검증했다.
- 최종 패키지의 UI 검사 **28개 항목 통과**, renderer 오류 0: AI 제공자 4, 개인·팀 리뷰 수정 3, 공간 분리 5, 보관함·복원 3, Git 4, 저널 9.
- 별도 최종 패키지 probe에서 Electron **44.9.1**, 네이티브 Copilot **1.0.100** 실행을 확인했다. OS credential store를 끈 격리 probe이며 모델 요청은 하지 않았다. ASAR 안의 실제 zod 실행에서도 큰 배열 입력을 오류 하나로 거부했다.
- 소스·번들·라이선스 **278개 바이트 일치**, 운영 package metadata 일치, 개발 산출물 제외, 엄격한 deep codesign 검증 통과. Packager가 제거하는 scripts·devDependencies 등 개발 metadata는 바이트 비교 대상에서 제외했다.

## 준비된 앱

`/Users/james_black/Applications/Dynote-updates/2026-11-02-security-dependencies/Dynote.app`

ASAR SHA-256: `26fd660b7ed31c228a146b5d451ce42b5ba6fe03bd705ee710b878fca7eb3d1f`

이 앱은 이전 `2026-11-02-personal-team-review-fixes` 준비본을 대체한다. 실제 `/Applications/Dynote.app`과 사용자 문서·AI 계정·Git 설정은 변경하지 않았다. Apple 공증, 이번 수정본의 Windows 네이티브 검증, 새 버전 공개 배포는 별도 남은 작업이다. 패키지 버전은 아직 `0.13.1`이며 기존 공개 태그나 파일을 교체하지 않았다.

증거: `output/verification/security-dependencies-{package,packaged-sdk,ready}.json`, `output/verification/copilot-extensions.json`, `output/playwright/`의 각 검사 보고서. 명령 로그는 `/private/tmp/dynote-security-dependencies-*.log`, 최종 audit JSON은 `/private/tmp/dynote-security-dependencies-audit.json`, 실패 재현 로그는 `/private/tmp/dynote-zod-red.log`에 남겼다.
