# Cloud Copilot Ask 사용 안내

이 기능은 같은 사람의 Local D-Note와 Cloud D-Note를 하나의 회사 승인 채널에 연결한다. 질문과 답변은 전용 비공개 Git 저장소에 남는다. 회사가 허용한 데이터 등급, Local에서 응답을 읽을 수 있는 단말, 저장 기한을 먼저 정한다. 채널 하나에는 Local 한 대와 Cloud Worker 한 대를 연결한다.

## 사용자

**설정 → Copilot 중계 Git**에서 이 PC의 역할과 적용된 저장소 주소를 확인한다. 관리자가 여러 저장소를 승인한 경우 목록에서 원하는 주소를 고르고 **중계 저장소 적용**을 누른다. 적용 완료 문구가 보이면 상대 PC에서도 같은 주소를 선택한다. 한 주소만 지정된 기존 설치에는 그 주소가 자동 적용된다. 진행 중인 질문과 게시 대기 중인 답변은 원래 저장소에서 마친다. 노트 백업 주소는 **설정 → 백업·복원**에서 별도로 관리한다.

1. Cloud PC에서 D-Note를 열고 오른쪽 Copilot 탭의 GitHub 계정 메뉴에서 관리자가 지정한 계정으로 로그인한다. 일반 Ask가 작동하는지 확인하고 앱을 열어 둔다.
2. Local PC에서 보관함을 열고 오른쪽 **Copilot** 탭을 누른다. 제공자 목록에 **Copilot · Cloud Ask**가 표시된다.
3. 질문을 입력하고 **보내기**를 누른다. 해당 질문의 텍스트만 전송한다. 표시가 **Git에 질문을 제출하는 중 → Cloud PC 대기 중 → 답변 도착**으로 바뀐다. 생성 중 상태를 조회한 경우 **Cloud Copilot 답변 생성 중**도 보인다.
4. 답변은 같은 패널에 표시된다. 패널이나 앱을 닫아도 같은 보관함을 다시 열면 최근 질문을 확인할 수 있다. 다음 질문을 보내면 최근 질문 기록이 교체된다. 이전 대화·열린 문서·선택 영역은 자동으로 보내지 않는다.

질문의 기한은 제출 시점부터 10분이다. 기한이 지났고 Git 연결이 끊겨 있으면 **기한 경과 · 서버 확인 대기**가 표시된다. 기존 질문을 열어 두면 연결 복구 후 같은 ID로 결과를 조회한다. 답변 업로드가 늦어지면 **기존 답변 다시 확인**을 눌러 기한 안에 생성된 답변을 가져올 수 있다. 새 질문을 보내면 이전 질문이 최근 기록에서 교체된다. 기한이 지난 질문을 다시 확인할 때는 추가 모델 호출이 발생하지 않는다.

Worker가 추론 도중 종료되어 완료 여부를 알 수 없으면 패널에 그 사유를 표시한다. 이때 질문을 새로 보내면 별도 추론이 발생할 수 있다. 이 PoC는 단일 Ask와 최종 답변을 제공한다. 다중 사용자, 파일 수정, 작업 취소, 토큰 스트리밍, 서비스 자동 시작은 후속 단계다.

## 관리자

전용 HTTPS Git 저장소 하나와 UUID 채널 하나를 지정한다. 기존 문서 백업 저장소와 분리한다. 읽기 권한은 해당 사용자와 Worker에만 부여한다. 서버 ruleset으로 Local 신원에는 `refs/heads/dynote-bridge/<channel>/request`, Cloud 신원에는 `refs/heads/dynote-bridge/<channel>/job/*` 갱신만 허용한다. 삭제·강제 덮어쓰기를 제한한다. D-Note는 직전 tip을 전제로 fast-forward 커밋을 게시한다. 양쪽 실행 계정에서 Git이 승인된 자격 증명 도우미를 통해 비대화식으로 읽고 쓸 수 있어야 한다.

설정의 `remote`에는 두 PC가 직접 사용하는 기본 HTTPS 주소를 입력한다. Bridge는 읽기와 쓰기를 현재 선택한 주소에 고정한다. 서명 키를 교체할 때는 진행 중인 질문을 마친 뒤 양쪽에 새 채널 UUID와 해당 ref 권한을 함께 배포한다. 이전 요청 기록은 이전 키로 서명되어 있다.

다른 전용 저장소도 선택할 수 있게 하려면 양쪽 관리 설정에 `"additionalRemotes": ["https://ghe.example.invalid/approved/ask-archive.git"]`처럼 승인된 HTTPS 주소를 추가하고 각각 동일한 채널 접근 권한을 준비한다. `remote`는 최초 기본값이고 사용자 선택은 PC별로 저장된다. 승인 목록에서 기존 선택을 없애면 사용자가 새 주소를 적용할 때까지 중계를 멈춘다. 노트 백업·팀 노트용 주소는 이 목록에서 제외한다.

양쪽 PC에 기본·추가 주소를 동일하게 배포한다. 기본 주소는 기존 서명 형식과 호환된다. 추가 주소에서는 주소 식별값까지 서명하므로 다른 중계 저장소에서 생성한 패킷은 거부된다. 운영 중 기본 주소를 바꾸려면 기존 작업을 마치고 새 채널로 전환한다.

각 PC에서 그 역할 전용 Ed25519 키 쌍을 준비한다. 개인키는 PKCS#8 PEM, 공개키는 SPKI PEM이다. OpenSSL이 있는 승인된 키 관리 환경의 예시는 다음과 같다. 각 PC에서 보호된 별도 폴더의 새 파일 이름을 사용한다.

```sh
openssl genpkey -algorithm ED25519 -out own-private.pem
openssl pkey -in own-private.pem -pubout -out own-public.pem
```

공개키만 상대 PC의 관리자에게 전달하고 지문을 대조한다. 개인키는 해당 실행 계정만 읽을 수 있게 OS ACL을 설정한다. Git 자격 증명과 패킷 서명 키는 별개다. 저장소에는 서명 키나 Copilot 토큰을 넣지 않는다.

두 PC에서 관리자만 변경할 수 있는 설정을 배포하고 D-Note를 다시 시작한다. Windows는 운영체제가 지정한 공용 데이터 폴더의 `Dynote\cloud-bridge.json`, macOS는 `/Library/Application Support/Dynote/cloud-bridge.json`, Linux는 `/etc/dynote/cloud-bridge.json`을 사용한다. 설정 파일, 공개키, 상위 디렉터리의 쓰기 ACL도 확인한다. 관리 위치를 정상 조회했고 설정 파일이 없으면 기존 Direct 방식으로 열린다. Windows에서 공용 폴더 조회에 실패하면 패널에 관리 오류가 표시되고 Direct 로그인이 차단된다.

다음은 형식을 보여 주는 Windows Local 설정이다. 주소와 경로는 승인된 실제 값으로 교체하고 UUID는 채널마다 새로 발급한다.

```json
{
  "role": "client",
  "channel": "9ac092f1-82ab-4188-a6a6-68e3d3199fc8",
  "remote": "https://ghe.example.invalid/approved/dynote-ask.git",
  "privateKeyFile": "C:/ProgramData/Dynote/keys/local-private.pem",
  "peerPublicKeyFile": "C:/ProgramData/Dynote/keys/cloud-public.pem"
}
```

Cloud 설정은 같은 channel·remote를 사용하고 role을 `worker`로 지정한다. privateKeyFile은 Cloud 자신의 개인키, peerPublicKeyFile은 Local의 공개키다. Cloud 설정에는 문자열 필드 `model`과 `copilotLogin`도 넣는다. Cloud D-Note의 사용 가능 모델 ID와 실제 GitHub Copilot 로그인 이름을 사용한다. 관리 설정이나 키가 올바르지 않으면 패널에 오류가 표시된다. Local용 설정에서는 Direct Copilot 로그인·실행 IPC가 차단된다.

## 보존 및 인수 확인

Git commit/ref, 서버 백업, 각 PC의 앱 데이터 `cloud-bridge/` 아래 캐시와 결과 파일을 보존 정책에 포함한다. 앱은 서버의 Git 이력을 정리하지 않는다. 관리자에게 승인된 폐기 절차와 유지 기한이 필요하다. 키 또는 저장소를 바꾸기 전 진행 중인 작업을 끝내고 기존 캐시 폐기를 확인한다.

서버에서 이전 작업 기록이 정리됐고 새 서명 요청이 도착하면 Worker는 게시가 끝나지 않은 옛 결과를 같은 앱 데이터 폴더의 `pending-result.json.<요청 ID>.retired`에 보관한다. 이 파일에는 답변이 포함될 수 있다. 원래 요청의 10분 기한이 지난 뒤 승인된 보존 절차에 따라 폐기한다.

승인된 Windows 두 대에서 합성 질문 한 건을 보내고 같은 보관함의 답변까지 확인한다. 잠금·로그오프·재부팅 시에는 Worker 앱 및 OS 자격 증명 저장소 상태를 각각 확인한다. Cloud PC가 재부팅되면 D-Note를 다시 실행한다.
