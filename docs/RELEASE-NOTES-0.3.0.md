# Dynote v0.3.0 — 그래프 엔진·Canvas·Bases

Markdown 문서의 연결을 탐색하고 시각적 보드와 속성 표를 사용할 수 있는 데스크톱 프리릴리스입니다.

## 주요 변경

- 새 그래프: WASM·Worker 물리 배치, GPU 표시, 점 드래그, 이동·확대/축소, 경로·태그 필터, 방향·깊이별 로컬 그래프, 보관함별 설정 저장.
- Canvas: 메모·파일·웹 링크·그룹 카드, 이동·크기 변경·연결, 실행 취소/다시 실행, 자동 저장.
- Bases: Markdown 속성 표, 필터·정렬·그룹·기본 수식, 속성 셀 편집·저장.
- 검토 후 수정: 초기 드래그 유실, 빈 그래프의 불필요한 계산, 큰 보관함의 Bases 계산 지연, 잘못된 Canvas 값 처리, 개발 서버의 WASM 자동 생성.

## 다운로드와 실행

- **Mac Apple Silicon**: `Dynote-0.3.0-mac-arm64.zip`을 풀고 `Dynote.app`을 실행합니다.
- **Windows x64**: `Dynote-0.3.0-windows-x64.zip`을 모두 풀고 `Dynote-win32-x64/Dynote.exe`를 실행합니다. DLL·resources 등 폴더 전체를 유지하세요.
- `SHA256SUMS.txt`로 다운로드 파일의 SHA-256을 비교할 수 있습니다. Node.js 설치는 필요 없습니다.

## 검증과 범위

자동 테스트 70개와 빌드 통과, 전체 의존성 검사에서 알려진 취약점 0건. macOS에서 실제 Electron 앱의 합성 문서·그래프·Canvas·Bases 동작을 검사했습니다. 앱 소스·번들 194개 파일, Windows 런타임 지원 파일 71개, ZIP 무결성을 확인했습니다.

Windows 실제 실행은 미검증입니다. 배포 서명·macOS 공증·설치 마법사·자동 업데이트가 없는 개발 버전입니다. Canvas/Bases는 기본 기능 범위이며, Obsidian 전체 기능·성능과의 동일성을 보장하지 않습니다. Live Preview·모바일·Obsidian Sync/Publish·기존 Obsidian 플러그인 호환은 포함하지 않습니다. Git 동기화는 별도 노트 저장소와 외부 Git 도구를 사용합니다.

[검토·수정 기록](https://github.com/mrdylee/dyNote/blob/v0.3.0/docs/RELEASE-REVIEW-0.3.0.md) · [Canvas/Bases 지원 범위](https://github.com/mrdylee/dyNote/blob/v0.3.0/docs/CANVAS-BASES.md) · [그래프 측정과 한계](https://github.com/mrdylee/dyNote/blob/v0.3.0/docs/graph-validation.md)
