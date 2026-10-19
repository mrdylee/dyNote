# Dynote 추가 기능과 open-obsidian 참고 검토

검토일: 2026-10-19. 대상: [JingHao-Leon/open-obsidian](https://github.com/JingHao-Leon/open-obsidian), 커밋 [`d6601440e1cd3dc049c6f81cb48903e0df61d047`](https://github.com/JingHao-Leon/open-obsidian/tree/d6601440e1cd3dc049c6f81cb48903e0df61d047). 로컬 HEAD와 원격 main이 이 커밋임을 재확인했습니다.

이번 검토에서 참고 저장소의 기존 테스트 116개가 통과했습니다. `npm audit`는 전체 의존성에서 6건(보통 3, 높음 1, 심각 2), 개발 의존성을 제외하면 0건을 보고했습니다. 테스트 통과나 취약점 목록만으로 아래 설계·보안 문제의 해소를 판단하지 않습니다. Dynote의 전체 의존성 검사 결과는 0건입니다.

## 결론

검색·링크 추천·속성·그래프의 참고 구현으로는 유용합니다. 데스크톱 파일 처리 전체를 교체하거나 프로젝트 전체를 이식하는 방법은 권하지 않습니다. Dynote의 CodeMirror, markdown-it, DOMPurify, 저장 충돌 검사와 복구 사본을 유지하고, 필요한 기능을 개별적으로 설계·검증하는 편이 적합합니다.

이 문서는 검토와 다음 개발 범위이며 기능 구현 완료 보고가 아닙니다. 이번 변경은 Dynote 이름 적용과 초기 소스 공개 준비입니다. 현재 Dynote에 해당 저장소 코드를 복사하지 않았습니다.

## 사용자 지정 범위

- 데스크톱: 이미지·PDF, 파일 이름 변경·이동·삭제와 링크 갱신, 링크 자동완성, 편집 영역 안의 Live Preview를 우선 개발 대상으로 둡니다.
- 속성·고급 검색·확장 문법·그래프 개선도 데스크톱 기능 범위입니다. Canvas·Bases·플러그인 호환은 크기가 큰 별도 설계 항목입니다.
- 모바일 연동, Obsidian Sync/Publish 연동은 제외합니다.
- 노트 동기화는 Git 저장소를 활용하는 방향입니다. 현재 Git 명령 실행이나 자동 동기화 기능을 추가한 것은 아닙니다.

## 기능별 판단

| 기능 | 참고 저장소의 실제 구현 | Dynote 적용 판단 |
| --- | --- | --- |
| 링크 자동완성 | `Editor.tsx`의 `findOpenLink`와 `wikilinks.ts`의 `suggestLinks` | 검색·추천 규칙을 참고할 수 있습니다. textarea를 옮기기보다 CodeMirror completion에 연결합니다. 중복 이름에서는 표시 제목과 저장할 실제 경로를 구분해야 합니다. |
| 검색 | `searchIndex.ts`: 증분 역색인, BM25, 구문·태그·경로·제외 검색, 한글을 포함한 CJK 문자/바이그램 처리 | 순수 로직의 재사용 후보입니다. 현재 한국어 부분 검색과 결과를 비교하고 수천 문서에서 측정해야 합니다. |
| 속성·태그 | `frontmatter.ts`의 YAML 부분 파서와 읽기 전용 `NoteDetails` | UI와 데이터 흐름을 참고할 수 있습니다. 완전한 YAML·형식별 속성 편집기로 간주하면 안 됩니다. 원본 YAML 보존과 안전한 파서 옵션이 필요합니다. |
| 그래프 | `graph.ts`, `GraphView.tsx`: force 배치, 미해결 문서, 태그 연결·경로 필터 | 데이터/화면 설계 참고에 적합합니다. 백링크와 동일한 링크 해석을 사용하고 양방향 링크의 방향·개수 정의를 일치시켜야 합니다. |
| 문서 삽입·체크박스 | `Preview.tsx`: 문서 본문 삽입과 체크박스 변경 이벤트 | 동작 방식을 참고하되, Dynote 저장 큐와 충돌 검사로 연결해야 합니다. 삽입 순환·깊이 제한, frontmatter와 본문의 줄 위치도 검증 대상입니다. |
| Live Preview | `Editor.tsx`는 textarea이고 `App.tsx`에서 별도 `Preview`와 나란히 표시 | 실시간으로 갱신되는 분할 미리보기입니다. Obsidian처럼 같은 편집 영역에서 서식을 표시하고 커서 위치만 소스를 드러내는 기능은 아닙니다. CodeMirror 기반으로 별도 구현해야 합니다. |
| 이미지·PDF | HTML 이미지 태그 생성은 있으나 첨부파일 보관·바이너리 IO·PDF 뷰어가 없습니다. `VaultAdapter.read/write`는 문자열 중심입니다. | 안전한 로컬 첨부파일 처리와 PDF 보기는 별도 구현해야 합니다. 외부 이미지 허용 코드를 그대로 가져오지 않습니다. |
| 파일 이름 변경·이동 | `NoteStore.renameNote`는 새 경로에 쓰고 원본을 삭제한 뒤 색인을 다시 만듭니다. | 연결 문서의 링크 일괄 갱신이나 실패 복구까지 해결하지 않습니다. 덮어쓰기 방지·원본 보존·진행 중 저장 처리·복구 가능한 링크 갱신이 필요합니다. |
| Markdown 문법 | 자체 렌더러의 제한된 문법 | 현재 markdown-it를 유지하는 편이 적합합니다. 일반 Markdown 링크도 백링크에 수집하도록 확장하고 각주·수식·Mermaid 등을 별도로 추가합니다. |
| Canvas·Bases·Obsidian 플러그인 | Canvas·Bases는 없고 플러그인 API도 Obsidian과 호환되지 않습니다. | 이 저장소를 가져와도 해결되지 않습니다. 각각 별도 구현·API 호환 검토가 필요합니다. |

근거 파일:

- [Editor.tsx](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/components/Editor.tsx), [App.tsx](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/App.tsx), [Preview.tsx](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/components/Preview.tsx)
- [searchIndex.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/core/searchIndex.ts), [frontmatter.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/core/frontmatter.ts), [wikilinks.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/core/wikilinks.ts), [graph.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/core/graph.ts)
- [noteStore.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/services/noteStore.ts), [vaultAdapter.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/services/vaultAdapter.ts), [COMPARISON.md](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/docs/COMPARISON.md)

## 그대로 도입하지 않을 부분

이전 보안 검토와 같은 커밋이며 다음 소스 경로가 현재도 존재함을 확인했습니다. 이전 재현은 가상 보관함으로 수행했고, 이번에는 관련 소스를 재확인했습니다.

1. **플러그인 자동 실행:** `App.tsx`의 ZIP 가져오기 이후 `plugins.scan()`이 실행됩니다. `PluginManager.scan()`은 `autoEnable = true`를 기본값으로 둡니다. 가져온 파일을 자동 실행하는 흐름을 채택하지 않습니다.
2. **플러그인 실행 경계:** `pluginHost.ts`는 `new Function`과 전역 이름 가리기를 사용합니다. 이전 합성 시험에서 전역 객체 접근과 문서 변경을 재현했으며 이를 안전한 격리 경계로 간주하지 않습니다.
3. **바이너리 ZIP 가져오기:** `NoteStore.importZip`은 각 엔트리를 `TextDecoder`로 문자열로 바꿔 씁니다. 이미지·PDF 바이트 보존에 적합하지 않고 `.git` 같은 숨김 설정과 기존 파일 덮어쓰기 정책도 보완해야 합니다.
4. **외부 이미지:** `markdown.ts`는 HTTP(S) URL을 이미지 태그로 만듭니다. 원격 요청이 가능한 경로라는 뜻이며, 실제 외부 수신이나 정보 유출이 관측되었다는 뜻은 아닙니다. Dynote에서는 로컬 첨부파일만 허용하는 정책부터 설계합니다.

관련 원본: [pluginManager.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/services/pluginManager.ts), [pluginHost.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/core/pluginHost.ts), [markdown.ts](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/src/core/markdown.ts).

## 라이선스와 출처

검토 커밋의 [LICENSE](https://github.com/JingHao-Leon/open-obsidian/blob/d6601440e1cd3dc049c6f81cb48903e0df61d047/LICENSE)는 MIT입니다. 실제 코드를 가져오는 경우 원 저작권 표시와 허가 고지를 보존하고, 가져온 파일·커밋·수정 내용을 별도 출처 문서에 기록합니다. 의존성을 추가하면 해당 라이선스도 별도로 확인합니다. 이 저장소의 라이선스가 Obsidian 원본 코드·자산이나 제3자 플러그인까지 사용 허가하는 것은 아닙니다.

## Git으로 노트를 동기화할 때

- `mrdylee/dyNote`는 앱 소스 저장소입니다. 노트·첨부파일은 사용자가 선택한 별도 저장소로 관리하며 개인 자료의 공개 여부를 구분합니다.
- 편집 전 변경 사항을 가져오고, 저장 완료 후 커밋·푸시하는 수동 흐름부터 검증합니다. 앱 안의 자동 pull/push는 별도 기능입니다.
- pull 전에 미저장 내용과 저장 큐를 처리하고, pull 후 파일을 다시 읽어 링크·검색 색인을 갱신해야 합니다. 현재 Dynote와 참고 저장소 모두 외부 파일 변경의 실시간 감시가 없습니다.
- Markdown 충돌은 사용자에게 보여주고 어느 쪽도 자동 폐기하지 않습니다. 삭제·이동 충돌도 처리해야 합니다. Git은 충돌을 없애 주거나 자동으로 실시간 동기화를 제공하지 않습니다.
- 이미지·PDF는 바이트 그대로 저장하고 바이너리 충돌에서 한쪽을 자동 선택하지 않습니다. 큰 첨부파일이 늘어나면 이력 용량과 Git LFS 필요성을 따로 검토합니다.
- SSH 키·토큰은 Git/운영체제 자격 증명 저장소에 맡기며 노트나 앱 설정에 평문으로 넣지 않습니다.

## 다음 구현 순서와 검증 기준

1. **첨부파일:** 로컬 이미지 붙여넣기·표시, PDF 열기. 원본 바이트 비교, 경로 이탈·심볼릭 링크 거부, 외부 요청 차단 유지 확인.
2. **파일 관리:** 이름 변경·이동·휴지통과 링크 갱신. 같은 이름 충돌, 폴더 간 상대 경로, 열린 초안, 부분 실패 복구 확인.
3. **편집:** CodeMirror 링크 자동완성, 체크박스, 편집 영역 안 Live Preview. 한글 IME, 커서·선택·실행 취소, 소스 원문 보존 확인.
4. **호환성과 탐색:** 일반 Markdown 링크의 백링크·그래프 반영, 속성·문서 삽입·고급 검색·그래프 개선. 동일한 링크 해석과 순환 삽입 제한, 한국어 검색 회귀 확인.
5. **노트 Git 흐름:** 별도 가상 노트 저장소와 두 작업 사본으로 정상 왕복 및 텍스트·바이너리·이동 충돌을 검증한 뒤 앱 내 연동 범위를 정합니다.

각 단계는 Mac과 Windows에서 파일 입출력·한글 편집·종료를 확인해야 합니다. Canvas·Bases·플러그인 호환은 이 기반 이후 각각 별도 설계와 검증이 필요한 항목입니다.
