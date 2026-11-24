# Copilot 중계 Git 설정 구현 계획

> Use superpowers:executing-plans for continuous inline implementation.

**목표** · 설정에서 노트 Git과 분리된 승인 중계 저장소를 선택하고 시험 릴리스로 배포한다.

- [x] `tests/cloud-bridge.test.mjs`에서 기존 단일 정책, 허용 목록과 선택 저장, 중복 주소, 처리 중 변경, 재시작을 검사한다.
- [x] `electron/bridge-policy.mjs`와 중계 설정 모듈에서 경로별 서비스 전환과 저장을 담당한다. `electron/main.mjs`와 preload를 통해 설정 조회·변경을 연결한다.
- [x] `src/App.jsx`에 독립 설정 탭을 연결한다. 두 Electron 인스턴스가 설정에서 선택한 저장소로만 합성 질문을 교환하는지 실제 Git으로 확인한다.
- [x] 기존 백업 및 Direct 회귀 검사, 코드 리뷰와 발견 사항 수정을 마친다. 운영 안내와 릴리스 노트에 최초 설정 절차를 기록한다.
- [ ] 공식 배포 워크플로에서 같은 커밋의 Windows·Mac 빌드를 검증하고 시험 릴리스의 공개 상태와 설치 자산을 확인한다.
