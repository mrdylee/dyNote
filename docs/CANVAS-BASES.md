# Canvas와 Bases (v0.3.0)

왼쪽 **+ Canvas** 또는 **+ Bases**에서 새 파일을 만듭니다. 기존 `.canvas`·`.base` 파일도 파일 목록에 표시됩니다. 두 형식 모두 자동 저장·충돌 검사·복구 사본·휴지통을 사용합니다. 파일 이동 시 Canvas의 파일 카드·그룹 배경·메모 링크를 갱신합니다. Bases의 경로 조건은 사용자가 작성한 질의이므로 자동 변경하지 않습니다.

## Canvas

공개 JSON Canvas 1.0 규격을 기반으로 합니다. 메모·파일·웹 링크·그룹 카드, 이동·크기 변경·연결선·색상·이름, 실행 취소/다시 실행을 지원합니다. 카드 가장자리 점을 연결하고 선택한 항목의 색상·이름을 편집하세요. 그룹을 이동하면 그 안에 완전히 들어 있는 카드도 함께 움직입니다.

파일 카드는 로컬 이미지를 표시하거나 문서·PDF를 기존 뷰어로 엽니다. 웹 링크는 외부 브라우저에서만 열며 웹페이지를 앱 안에 삽입하지 않습니다. 하위 제목·블록 지정은 보존하지만 현재는 문서 전체를 엽니다. 알려지지 않은 카드 형식은 읽기 전용이며 JSON 확장 필드를 보존합니다. PNG 내보내기·자유 곡선 그리기·Obsidian 확장 플러그인은 지원하지 않습니다. 5,000개 카드·10,000개 연결 상한은 대규모 보드의 성능 보장이 아닙니다.

## Bases

보관함의 **Markdown 문서**를 데이터로 사용합니다. 기본 생성 시 파일명과 현재 존재하는 노트 속성을 표로 보여줍니다. `file.*`와 `formula.*` 열은 읽기 전용이고 노트 속성은 셀에서 편집합니다. 날짜 선택기 등 Obsidian의 모든 속성 UI는 제공하지 않습니다. 숫자·불리언·목록은 기존 형식에 맞게 입력하며, YAML 주석과 본문을 보존합니다. 셀 편집으로 필터 조건에서 빠지면 해당 행이 사라질 수 있습니다.

**보기 설정 편집**에서 YAML을 수정합니다. 지원하는 기본 예:

```yaml
filters: 'project == "BMS"'
formulas:
  total: price * count
views:
  - type: table
    name: 시험 목록
    order: [file.name, note.status, formula.total]
    sort: [{property: formula.total, direction: DESC}]
    groupBy: {property: note.status, direction: ASC}
```

여러 보기 선택·열 이름·표시할 열·비교/태그/경로 조건·기본 계산식·정렬·그룹·행 수 제한을 지원합니다. 카드·지도·칸반·요약 계산·플러그인 보기·첨부파일 행은 지원하지 않습니다. 미지원 설정은 안내와 함께 읽기 전용으로 열어 원문을 유지합니다.

필터·수식 계산은 앱 권한이 없는 별도 로컬 Worker에서 실행하고 약 1.8초를 초과하면 중단합니다. 새 설정을 입력하는 동안 YAML이 잘못되면 자동 저장을 거부하고 열린 초안을 유지합니다. 앱 강제 종료까지 초안을 보존하는 기능은 없습니다. 필터 엔진은 별도 오픈소스 구현이며 Obsidian 전체 호환을 보장하지 않습니다.

## 참조

- JSON Canvas: https://github.com/obsidianmd/jsoncanvas (JSON Canvas 1.0)
- React Flow 12.12.0: https://github.com/xyflow/xyflow
- Bases expression runtime 0.3.0-rc.4: https://github.com/callumalpass/obsidian-bases-expression
- 원래 참고한 `JingHao-Leon/open-obsidian`의 `d6601440`에는 Canvas/Bases 구현이 없습니다.
