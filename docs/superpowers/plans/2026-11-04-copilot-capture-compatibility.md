# Copilot Capture Compatibility Validation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 임시 VS Code Copilot 세션에서 자동 수집과 MCP 기록 요청을 연결할 수 있는지 확인하고 원문 보존의 지원 범위를 확정한다.

**Architecture:** 제품 구현에 앞서 합성 대화와 임시 프로젝트로 Hook/MCP 경계를 검증한다. 이 계획의 산출물은 버전별 이벤트/원문 fixture와 검증 보고서이며 개인 보관함이나 실제 업무 대화는 사용하지 않는다. 제품 수신부 및 편집기 삭제 연동의 구현 계획은 이 호환성 결과를 근거로 별도로 작성한다.

**Tech Stack:** VS Code, Copilot harness/Local compatibility, Node.js, JSON/JSONL, 기존 Dynote native verification 방식.

---

**상태:** MCP 계획 보류. 현재 진행한 구현과 검증은 2026-11-04-copilot-journal-auto.md를 따른다. 아래 MCP 도구 검증 단계는 실행 완료로 간주하지 않는다.

## 작업 파일과 경계

- 참조: docs/superpowers/specs/2026-11-04-copilot-capture-mcp-design.md
- 합성 fixture: tests/fixtures/copilot-capture/ 아래, 검증한 버전과 harness로 구분한다.
- 원시 실행 자료: output/verification/copilot-capture-compatibility/ 아래, Git에 추가하지 않는다.
- 최종 보고서: docs/verification/2026-11-04-copilot-capture-compatibility.md
- 제품 코드, 사용자 Hook 설정, 원본 개인 대화, Git 원격, 자동 백업 설정은 이 단계의 수정 대상이 아니다.

## Task 1: 환경과 원문 범위 확인

- [ ] 설치한 VS Code와 Copilot 버전, 선택한 Session Target, 로컬/원격 실행 위치를 기록한다. package.json 메타데이터만으로 실행 성공을 판정하지 않는다.
- [ ] 임시 프로젝트와 별도 VS Code 프로필을 준비한다. 환경이 계정 연결을 요구하면 기존 프로필의 인증 비밀을 복사하지 않고 사용자 주도의 로그인 경로를 사용한다.
- [ ] 테스트 문장은 `DYN_CAPTURE_U1`, `DYN_CAPTURE_A1`, `DYN_CAPTURE_U2`처럼 고유 표식을 사용한다. 요청은 “DYN_CAPTURE_A1만 답해 줘”처럼 짧게 만든다.
- [ ] Chat: Export Chat...으로 해당 합성 세션을 JSON으로 내보낸다. 화면에 표시된 질문/답변, 파일의 메시지 순서와 문자열을 대조한다.
- [ ] 합성 응답에 한국어, 줄바꿈, 코드 블록, 같은 문장 반복을 각각 포함한다. 모델의 응답 재작성과 파일 원문 수집의 차이를 보고서에 기록한다.

통과: 실제 메시지/응답의 보존 범위를 파일로 입증한다. 실패: 해당 환경에서는 원문 보존 지원을 표시하지 않고 수동 내보내기 경로를 남긴다.

## Task 2: Hook의 세션 식별과 실행 순서 확인

- [ ] 임시 프로젝트에만 해당 harness 문서에 맞는 진단 Hook을 설치한다. sessionStart, agentStop, preCompact를 관찰한다. 기존 사용자 Hook 파일은 편집하지 않는다.
- [ ] 진단기는 stdin JSON에서 event 이름, 세션 ID, cwd, transcript 경로 존재 여부만 기록한다. 질문, 응답, 도구 인자, 환경 변수, 인증값은 로그에 쓰지 않는다. stdout은 해당 harness의 빈 성공 결과를 반환하며 block/continue 요청을 하지 않는다.
- [ ] sessionStart가 지원하는 경우 합성 context 표식 `DYN_CAPTURE_CONTEXT_<세션별 값>`을 넣고 MCP 요청에서 동일 세션을 식별할 수 있는지 확인한다. 전달값을 권한 증명으로 취급하지 않는다.
- [ ] 새 세션, 후속 질문, 세션 재개, 응답 중단, 오류, 압축 전 이벤트를 각각 관찰하고 발생/미발생을 기록한다.
- [ ] 같은 프로젝트 두 세션과 다른 프로젝트 한 세션을 동시에 열어 각각의 식별자가 섞이지 않는지 확인한다.
- [ ] 같은 프로젝트에서 세션을 닫고 열기, 재시작, 다음 날 재개를 재현한다. 세션 ID가 달라도 동일 프로젝트로 연결되는 근거와 메시지 발생 날짜의 가용성을 기록한다. 여러 root를 가진 workspace는 자동으로 한 프로젝트로 합치지 않는다.

통과: 검증 대상 harness에서 이벤트와 프로젝트/세션 연결을 입증한다. 미발생 이벤트는 “지원 불명”으로 남기고 다른 harness의 payload로 대신 성공 처리하지 않는다.

## Task 3: 자동 수집과 MCP 예약의 결합 확인

- [ ] 임시 대화만 처리하는 MCP 진단 서버를 사용해 `record_request`라는 관찰용 도구를 등록한다. 도구 입력은 `captureRef` 한 필드이고 결과는 `state: queued`다. 이 단계에서는 보관함에 쓰지 않는다.
- [ ] “진단 도구를 호출한 다음 DYN_CAPTURE_AFTER_TOOL로 답변을 마쳐 줘”를 실행한다.
- [ ] 진단 도구 호출 시점과 agentStop의 순서, 각 시점 transcript의 마지막 응답 존재 여부를 대조한다.
- [ ] agentStop 수집 후 원문에 `DYN_CAPTURE_AFTER_TOOL`이 있는지 확인한다. 파일 flush가 늦으면 완료 snapshot을 확인하는 조건을 정하고 대기 시간만으로 원문 완성을 가정하지 않는다.
- [ ] 도구 호출 직후 취소/창 종료를 재현한다. 마지막 응답을 확보하지 못했을 때 저장 완료로 표시하지 않는 결과가 가능한지 기록한다.

통과: 도구의 동기 응답을 기다리는 동안 Hook 실행을 막지 않고 마지막 응답을 나중에 확보할 수 있다. 실패: “한 번 저장”의 대상은 이전 완료 turn까지로 한정하고 UI에 범위를 표시하는 대안을 보고서에 제시한다.

## Task 4: 원문 중복과 형식 변경의 판정 근거 확보

- [ ] 동일 이벤트를 세 번 재생했을 때 동일한 source revision을 판별할 수 있는 필드를 기록한다.
- [ ] 프로젝트 기록 시작/중단 시점을 합성 메시지의 순서와 대조해 적용 경계를 정한다. 날짜별 프로젝트 묶음 삭제와 세션별 제외의 서로 다른 범위를 fixture 메타데이터로 표현할 수 있는지 확인한다.
- [ ] “네” 같은 동일 텍스트를 두 번 입력해 두 메시지를 서로 구분하는 근거를 기록한다.
- [ ] 응답 재생성, 분기, 압축, 세션 재개에서 원본 ID/순서/revision이 어떻게 바뀌는지 합성 fixture로 남긴다.
- [ ] transcript가 없거나 형식이 다른 경우 원문 누락을 조용히 무시하지 않고 unsupported/partial로 구분하는 조건을 정한다.
- [ ] 허용 경로 밖 파일, symlink, 읽는 중 변경된 파일은 fixture로 재현하고 수집 범위 검증에 필요한 조건을 보고서에 명시한다.

통과: parser 설계에 필요한 실제 표본과 중복 판정 근거가 있다. 원문 형식을 추측해서 parser를 먼저 작성하지 않는다.

## Task 5: 결과 정리와 다음 구현 범위 결정

- [ ] 보고서에 OS, VS Code/Copilot 버전, harness, 실행 위치, 이벤트 표, 원문 보존 범위, 실패 사례를 적는다.
- [ ] 합성 fixture에는 개인정보/로그인 값/실제 코드가 없는지 확인한다. 원시 실행 자료는 ignored output에 남긴다.
- [ ] 검증한 환경만 지원 목록에 넣는다. Windows 실행이 없으면 Mac 결과로 Windows를 통과 처리하지 않는다. WSL/SSH/컨테이너도 각각 구분한다.
- [ ] 결과에 맞춰 제품 구현 계획을 작성한다: 수집 저장소 → MCP 예약/추적 → 활성 개인 보관함 반영 → 관리되는 저널 항목 삭제/복원 → 패키징 검증.
- [ ] 기능을 만들기 전 실행할 핵심 회귀 시나리오는 설계 문서의 검증 기준을 사용한다. 이 단계에서 기존 제품 전체 테스트를 실행해 미구현 기능의 성공을 주장하지 않는다.

## 완료 판정

MCP 설정이 보이거나 Hook 파일이 존재한다는 사실은 완료가 아니다. 실제 합성 대화의 메시지 범위와 세션 연결, 도구 호출 뒤 마지막 응답의 수집을 증명하는 보고서가 있어야 이 검증 단계가 완료된다.
