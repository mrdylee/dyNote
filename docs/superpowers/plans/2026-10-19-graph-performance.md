# Dynote Graph Performance Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 고정 SVG 그래프를 독립 계산 코어·Worker·GPU 화면으로 교체하고 기존 탐색 기능을 보존하면서 대규모 자료 성능을 검증한다.

**Architecture:** 링크 조회와 문서 파싱의 반복 비용을 먼저 줄인다. 연속 메모리의 독립 WASM 계산 코어를 벤치마크한 뒤 Worker와 PixiJS에 연결한다. 매 프레임 좌표는 React 바깥에서 처리하며 데이터 세대, 버퍼 소유권, 자원 해제를 명시한다.

**Tech Stack:** 기존 React/Vite/Electron/Node test. 후보 PixiJS 8.22.0, AssemblyScript 0.28.20. 도입 시 실제 패키지 API·CSP 동작과 잠금 파일을 확인한다.

---

기준 설계: `docs/superpowers/specs/2026-10-19-graph-performance-design.md`.
상태: 성능/조작 엔진 구현 및 로컬 패키지 검증 완료. 전체 앱 원본 비교 계측과 Windows 원생 실행은 미검증이며 `docs/graph-validation.md`에 구분해 기록했다. 이 계획은 첫 번째 구현 단위인 성능/조작 엔진을 대상으로 한다. 원본의 모든 그래프 기능을 완료했다고 판단하는 기준으로 사용하지 않는다.

## 파일 책임

| 파일 | 변경 책임 |
|---|---|
| `core/links.mjs` | 현재 해석 규칙을 보존하는 경로 인덱스 |
| `core/knowledge.mjs` | 문서 내용 파싱 캐시, 인덱스 기반 링크/백링크 생성 |
| `core/graph.mjs` (신규) | 안정적인 ID, 연속 인덱스, 차수·인접 목록, 로컬 BFS |
| `assembly/graph.ts` (신규) | 독립 공간 분할·힘·적분 코어 |
| `scripts/build-graph.mjs` (신규) | 고정된 컴파일 옵션으로 번들 WASM 생성 |
| `core/graph-kernel.mjs` (신규) | WASM 초기화·메모리 배열·고정점 JS 인터페이스 |
| `src/graph.worker.mjs` (신규) | 계산/냉각/전송 흐름, 데이터 세대 관리 |
| `src/graph-renderer.mjs` (신규) | Pixi 자원, 카메라, 포인터, 컬링, RAF |
| `src/Graph.jsx`, `src/styles.css`, `src/App.jsx` | 기존 기능을 새 엔진에 연결, 저장소 ID 전달 |
| `core/security.mjs`, `electron/main.mjs`, `index.html` | 번들 WASM 확장자/MIME/CSP |
| `package.json`, `package-lock.json` | 직접 의존성과 빌드 순서 |
| `tests/graph.test.mjs`, `tests/graph-kernel.test.mjs` (신규) | 모델 및 계산의 동작 검증 |
| `tests/knowledge.test.mjs`, `tests/security.test.mjs` | 해석 규칙·프로토콜 회귀 검증 |
| `scripts/benchmark-graph.mjs` (신규) | 독립 코어/모델 성능 측정, 원본 파일에 의존하지 않음 |

## Task 1: 링크 조회와 재파싱 비용

- [x] `tests/knowledge.test.mjs`에 내용·이름·별칭 변경 및 저장소 교체 회귀 테스트를 추가한다. 예:

```js
test("renaming an alias target does not retain its previous backlink", () => {
  const initial = [
    { path: "A.md", content: "[[별칭]]" },
    { path: "B.md", content: "---\naliases: [별칭]\n---\nB" },
  ];
  assert.deepEqual(buildKnowledge(initial).edges, [
    { source: "A.md", target: "B.md" },
  ]);
  const renamed = [initial[0], { ...initial[1], path: "C.md" }];
  assert.deepEqual(buildKnowledge(renamed).edges, [
    { source: "A.md", target: "C.md" },
  ]);
  assert.deepEqual(buildKnowledge([initial[0]]).edges, []);
});
```

- [x] `resolvePath`에 전달하는 파일 목록과 같은 스냅샷으로 path/basename/alias Map을 한 번 만든다. 각 키의 값은 배열 또는 Set으로 두고, 후보가 여러 개면 기존처럼 ambiguous를 반환한다. 조회 우선순위와 Unicode 정규화 규칙은 바꾸지 않는다.
- [x] 위 항목의 인덱스를 링크/백링크 생성에 적용한다. 기존 배열 호출자를 강제로 바꾸지 않고 새 선택 인자로 인덱스를 전달한다. 경로가 같고 내용이 같으면 Markdown 토큰/메타데이터/링크 파싱 결과를 재사용하며, mtime 등 입력 메타데이터는 최신 값을 합친다. 현재 목록에서 사라진 캐시는 제거한다.
- [x] `node --test tests/knowledge.test.mjs tests/desktop.test.mjs` 실행. 이어 `npm test`로 기존 51개 이상 모두 통과 확인.
- [x] 동일 1천/5천 합성 문서로 초기/단일 변경 시간을 측정한다. 현재 5천 기준 초기 약 3.95초/수정 약 3.87초와 비교해 기록한다. 개선 없이 캐시 계층만 늘리지 않는다.
- [x] 변경 파일만 커밋: `perf: index note links and reuse unchanged parsing`.

## Task 2: 그래프 데이터 모델

- [x] `core/graph.mjs`에 `buildGraph(notes, edges)`와 `selectGraph(graph, { path, tag, active, local, depth, incoming, outgoing, neighborLinks })`를 정의한다. 결과는 `nodes`, 정수 `links`, ID→인덱스 `index`, 양방향 `adjacency`, 방향별 `incomingAdjacency`/`outgoingAdjacency`다. 순서는 입력 노트 순서를 보존한다. 차수/인접 목록은 링크를 한 번 순회해 구성한다.
- [x] 필터 전 그래프에서 선택한 incoming/outgoing 방향으로 BFS를 진행해 로컬 범위를 결정한 뒤 현재 경로/태그 필터와 교집합을 취한다. 기본값은 incoming/outgoing 모두 true다. neighborLinks=false이면 선택한 BFS에서 방문한 노드 간의 탐색 연결만 표시하고, true이면 포함된 노드 사이의 나머지 연결도 표시한다. 이 규칙은 독립 구현의 명시적 정의이며 깊이 2 이상에서 원본과 별도 대조한다. 빠진 끝점을 가진 선은 출력하지 않는다. 방향 반대 링크는 데이터상 보존하고 인접 목록은 중복 없는 집합으로 만든다.
- [x] `tests/graph.test.mjs`에서 A→B→C와 고립 D를 사용해 깊이 1 결과 A/B, 깊이 2 결과 A/B/C, 경로 필터 B 결과 B와 빈 링크를 검증한다. 자기 링크·없는 끝점·중복 입력 처리도 명시한다.
- [x] B를 중심으로 incoming만 켜면 A/B, outgoing만 켜면 B/C가 나오는지 검사한다. 양쪽을 켜고 A→C를 추가한 자료에서 깊이 1의 neighborLinks=false는 중심과의 두 연결만, true는 A→C까지 출력해야 한다. 원본 1천 보관함의 중심 44 및 이웃 13/43/45/75도 회귀 자료로 사용한다.
- [x] `node --test tests/graph.test.mjs` 통과 후 `feat: build graph adjacency and local selection` 커밋.

## Task 3: 독립 WASM 코어의 성능 판정

- [x] 개발 의존성에 고정 AssemblyScript 버전을 추가하고 빌드 스크립트를 만든다. 릴리스 최적화, 고정 최대 메모리, 소스맵 제외를 명시한다. 생성 WASM은 `src/generated/graph.wasm`에 두고 빌드 때 재생성한다. 원본 바이너리·WAT·생성 C를 가져오지 않는다.
- [x] JS 공개 API를 `createKernel(bytes, { positions, links, radii })` → `{ step(alpha, settings), positions(), pin(index, x, y), unpin(index), dispose() }`로 고정한다. `positions`는 x/y 교차 Float32Array, `links`는 양끝 인덱스 교차 Uint32Array다. 배열 길이와 인덱스 범위를 초기화 때 검증한다.
- [x] 먼저 중심 힘/감쇠/고정점만 구현하고 `tests/graph-kernel.test.mjs`에서 단일 점이 원점 방향으로 이동하는지, pin 후 step에도 지정 좌표가 유지되는지 검증한다. 빈 그래프와 dispose 후 동작도 검사한다.
- [x] 링크 힘을 추가한다. 거리가 목표보다 길면 접근, 짧으면 이격하며 연결 차수에 따라 속도 배분한다. 두 점의 길고 짧은 연결에서 거리 오차가 감소하는 테스트로 확인한다.
- [x] 평탄한 배열 기반 공간 분할과 먼 셀 집계 근사를 추가한다. 셀에는 영역, 점 수, 무게중심, 하위 인덱스를 둔다. 노드를 포함한 셀을 자기 힘으로 합산하지 않는다. 겹친 좌표에는 인덱스로 결정한 미세 변위를 적용하고 분할 깊이를 제한한다. 가까운 셀에서만 반경 충돌을 처리한다.
- [x] 결정적 입력에 300단계 실행 후 NaN/Infinity 없음, 겹친 점 분리, 연결 길이 오차 감소, 고립/허브/밀집 배열 종료를 검사한다. 좌표의 원본 일치를 요구하지 않는다.
- [x] `scripts/benchmark-graph.mjs`에서 1천/5천/1만 노드 및 각 2N/8N 연결을 생성해 10회 준비, 30회 측정, 3회 반복한다. 중앙값/p95, 메모리, 유한성 결과를 JSON으로 기록한다. 원본 비교 데이터는 연구 파일에서 수동 비교하며 제품 시험은 원본 설치를 요구하지 않는다.
- [x] 동일 spiral 조건에서 원본 WASM 대비 중앙값 1.5배 이내를 내부 목표로 확인하고, 다른 배치의 품질과 p95도 확인한다. 미달 시 코어를 개선하고 결과를 보고한다. 목표 미달을 숨긴 채 화면 교체 완료로 보고하지 않는다.
- [x] 코어·테스트·측정·잠금 파일 커밋: `feat: add independently implemented graph simulation kernel`.

## Task 4: Worker 수명과 데이터 전송

- [x] `src/graph.worker.mjs`에 다음 프로토콜을 구현한다. 입력: `{ type: "graph", epoch, positions, links, radii }`, `{ type: "settings", epoch, settings }`, `{ type: "pin", epoch, index, x, y }`, `{ type: "unpin", epoch, index }`, `{ type: "recycle", epoch, buffer }`, `{ type: "pause", epoch }`, `{ type: "resume", epoch }`. 출력: `{ type: "frame", epoch, buffer, settled }` 또는 `{ type: "error", epoch, message }`.
- [x] epoch가 다른 명령/버퍼는 버린다. 전송 버퍼 두 개만 유지하고 반환 전 추가 프레임을 쌓지 않는다. 계산 alpha는 새 데이터/드래그/힘 변경에서 재가열하고 임계치 아래 예약을 중단한다. 숨긴 화면은 pause, 재표시는 resume, 컴포넌트 해제는 terminate로 처리한다.
- [x] 전송 테스트에서 구 epoch 프레임 무시, 버퍼 반환, pause 후 계산 중단, 새 데이터 설치 후 pin 인덱스 초기화를 확인한다. 실제 브라우저/앱 Worker도 확인한다.
- [x] `feat: run graph simulation in a bounded worker loop` 커밋.

## Task 5: PixiJS 렌더링과 기존 Graph 연결

- [x] 고정 PixiJS 의존성 추가. `src/graph-renderer.mjs`에서 `createGraphRenderer(container, { onOpen, onPin, onUnpin })` 비동기 팩토리를 정의한다. 반환 메서드: `setGraph(graph)`, `setPositions(array)`, `setActive(id)`, `setDisplay(settings)`, `fit()`, `destroy()`.
- [x] 한 WebGL 캔버스와 흰 배경, 점/선 배치, 필요할 때만 라벨 생성을 구현한다. 카메라 좌표는 refs/렌더러에 두고 React 재렌더를 일으키지 않는다. 선택/hover 이웃 강조는 인접 목록에서 가져온다.
- [x] 화면 밖 요소 컬링을 적용하되 양 끝점이 밖이어도 화면과 교차하는 선은 보존한다. 점 생성은 프레임별로 나눠 초기 화면의 긴 정지를 줄인다. 위치·카메라·hover 변경이 없으면 RAF와 Pixi ticker를 중단한다.
- [x] 화면 좌표와 세계 좌표 변환을 단일 함수 쌍으로 만들고 왕복 테스트한다. 4 CSS 픽셀 이상 이동 시 드래그로 처리해 손을 놓을 때 문서가 열리지 않게 한다. pointercancel/lostpointercapture에서도 pin을 해제한다. 커서 중심 확대, 배경 이동, fit을 구현한다.
- [x] `src/Graph.jsx`의 SVG를 컨테이너로 교체한다. 기존 경로/태그/로컬/깊이·문서 열기를 새 모델에 연결한다. 로컬 모드에 incoming/outgoing/neighborLinks 토글을 연결한다. 힘 4종과 표시 3종 조절, 기본값 복원을 추가한다. 라벨은 확대율에 따라 투명도가 변하게 하고 hover/선택 문서는 우선 표시한다. 저장 키는 `dynote:graph:<vaultId>`이며 다른 저장소 설정이 섞이지 않도록 한다.
- [x] 키보드 화살표/+/− 이동·확대와 문서 선택 컨트롤을 검증한다. 컴포넌트 해제 시 Observer/이벤트/Worker/렌더러/RAF를 모두 정리하고 React StrictMode 재마운트에서도 이중 캔버스가 남지 않게 한다.
- [x] `feat: render interactive graph with GPU batching` 커밋.

## Task 6: 실제 앱 CSP와 회귀·성능 검증

- [x] `core/security.mjs`의 확장자 허용 목록에 `.wasm`, `electron/main.mjs`에 `application/wasm`을 추가한다. `notes://app/assets/graph.wasm` 허용과 `notes://vault`/경로 이탈 차단 회귀 테스트를 추가한다. 새 임의 파일 읽기 API를 만들지 않는다.
- [x] `index.html`에 WASM 실행에 필요한 CSP만 적용한다. Pixi의 CSP 호환 모듈을 해당 버전 소스에서 확인한 뒤 사용한다. 일반 eval 허용이나 외부 origin 추가로 우회하지 않는다.
- [x] `npm test`, `npm run build` 실행. actual `notes://app/index.html` Electron에서 Worker/WASM/WebGL 로딩, 한국어 라벨, 필터, 클릭, 드래그, 저장소 교체, 그래프 반복 진입/종료, 냉각 후 유휴 동작을 확인한다.
- [ ] 동일 크기 창과 합성 문서 집합에서 원본/신규 앱의 첫 표시·프레임 p95·입력 지연·메모리·단일 문서 수정 반영을 측정한다. **Dynote 계측만 완료. 원본과 일치시킨 presentation FPS/OS 입력 지연/총 메모리 비교는 미실시.** 계산 코어 시간과 전체 앱 수치를 따로 기록한다. 측정되지 않은 항목은 미검증으로 표시한다.
- [x] macOS/Windows 패키지에서 WASM 포함과 로드 경로를 확인한다. 실제 Windows 실행이 불가능하면 패키지 구조 검증만 수행했다고 명시한다. 게시·push는 이 계획에 포함하지 않는다.
- [x] 결과와 잔여 기능 차이를 `docs/graph-validation.md`에 기록하고 `test: verify graph performance and packaged runtime` 커밋.

## 별도 후속 구현 단위

태그/첨부/미생성 점, 고립점 표시, 검색 색상 그룹, 화살표, 생성 시간 애니메이션, 원본 검색 문법·프런트매터 링크 의미, 문서 옆 로컬 그래프 패널은 데이터 의미와 UI를 함께 검증하는 별도 계획으로 진행한다. 성능 엔진 교체와 이 기능들의 호환 완료 상태를 구분한다.

## 구현 기록

Worker 프로토콜 테스트를 위해 `core/graph-loop.mjs`, 좌표/컬링 검증을 위해 `core/graph-camera.mjs`를 분리했다. 재현 가능한 Electron 검증은 `scripts/verify-graph-runtime.mjs`에 있다. 독립 계산 코어의 목표 수치와 실제 화면 검증의 한계는 `docs/graph-validation.md`에 기록했다.
