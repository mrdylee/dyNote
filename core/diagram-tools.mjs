export const diagramSamples = [
  {id:'flowchart',label:'흐름도',code:'flowchart LR\n  Start[시작] --> Check{확인}\n  Check -->|완료| End[종료]'},
  {id:'sequence',label:'시퀀스',code:'sequenceDiagram\n  User->>App: 요청\n  App-->>User: 응답'},
  {id:'class',label:'클래스',code:'classDiagram\n  class Notebook\n  Notebook : +open()'},
  {id:'state',label:'상태',code:'stateDiagram-v2\n  [*] --> Ready\n  Ready --> Saved: 저장\n  Saved --> [*]'},
  {id:'er',label:'개체 관계',code:'erDiagram\n  NOTEBOOK ||--o{ NOTE : contains\n  NOTE {\n    string title\n  }'},
  {id:'journey',label:'사용자 여정',code:'journey\n  title 기록하기\n  section 작성\n    노트 열기: 5: 사용자\n    기록 저장: 4: 사용자'},
  {id:'gantt',label:'간트',code:'gantt\n  title 개발 일정\n  dateFormat YYYY-MM-DD\n  section 구현\n  설계 :a, 2026-10-27, 2d\n  검증 :after a, 2d'},
  {id:'pie',label:'원형 차트',code:'pie title 작업 상태\n  "완료" : 3\n  "진행" : 2'},
  {id:'requirement',label:'요구사항',code:'requirementDiagram\n  requirement note_save {\n    id: 1\n    text: save note\n    risk: low\n    verifymethod: test\n  }'},
  {id:'git',label:'Git 그래프',code:'gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  checkout main\n  merge feature'},
  {id:'mindmap',label:'마인드맵',code:'mindmap\n  root((노트))\n    생각\n      연결\n    기록'},
  {id:'timeline',label:'타임라인',code:'timeline\n  title 개발 기록\n  설계 : 요구사항\n  구현 : 기능\n  검증 : 결과'},
  {id:'c4',label:'C4',code:'C4Context\n  Person(user, "사용자")\n  System(app, "노트 앱")\n  Rel(user, app, "기록")'},
  {id:'quadrant',label:'사분면',code:'quadrantChart\n  title 우선순위\n  x-axis 낮은 비용 --> 높은 비용\n  y-axis 낮은 효과 --> 높은 효과\n  작업: [0.3, 0.7]'},
  {id:'sankey',label:'생키',code:'sankey-beta\n\nWrite,Save,8\nWrite,Wait,2'},
  {id:'xy',label:'XY 차트',code:'xychart-beta\n  title "기록 수"\n  x-axis ["월", "화", "수"]\n  y-axis "개수" 0 --> 10\n  bar [3, 6, 8]'},
  {id:'kanban',label:'칸반',code:'kanban\n  todo[할 일]\n    task[요구사항 확인]\n  done[완료]\n    plan[설계]'},
  {id:'architecture',label:'아키텍처',code:'architecture-beta\n  group app(cloud)[Application]\n  service storage(database)[Storage] in app\n  service api(server)[API] in app\n  api:R -- L:storage'},
  {id:'block',label:'블록',code:'block-beta\n  columns 3\n  input["입력"] process["처리"] output["출력"]\n  input --> process\n  process --> output'},
  {id:'packet',label:'패킷',code:'packet-beta\n  0-7: "Header"\n  8-31: "Payload"'},
];
export function diagramInsertion(content, from, code) {
  let fence=null, mermaid=false;
  for(const line of content.slice(0,from).split(/\r\n|\r|\n/)) {
    const marker=line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if(!marker)continue;
    if(!fence){fence=marker[1];mermaid=/^mermaid\s*$/.test(marker[2]);}
    else if(marker[1][0]===fence[0] && marker[1].length>=fence.length){fence=null;mermaid=false;}
  }
  return fence && mermaid ? code : `\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
}
