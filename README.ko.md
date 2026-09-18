# tokenloom

[English](./README.md)

코딩 에이전트가 컴포넌트를 구현하는 데 필요한 Figma 맥락만 가져오도록 돕는 CLI입니다.

tokenloom은 Figma 페이지 export를 코드 생성에 필요한 컴포넌트 맥락과 디자인 토큰으로 변환합니다.
변환 과정은 로컬에서 결정적으로 동작하며 language model을 호출하지 않습니다.

```text
Figma
  │
  ▼
tokenloom exporter
  │
  ▼
snapshot
  │
  ├── tokenloom context ──▶ coding agent ──▶ component code
  │
  └── tokenloom tokens  ──▶ DTCG / CSS / Swift / Kotlin
```

코딩 에이전트가 Figma의 전체 노드 트리를 직접 탐색하는 대신, tokenloom이 먼저 컴포넌트와 variant를
찾고 현재 작업에 필요한 범위만 전달합니다.

## 바로 실행해보기

Figma 없이 tokenloom을 처음부터 끝까지 실행해 볼 수 있습니다. `samples/` 아래에 sample snapshot이
들어 있어, `npx`로 배포된 패키지를 이 snapshot에 바로 돌려볼 수 있습니다. Node.js 22 이상이
필요합니다.

이 저장소를 clone한 뒤 루트에서 bundled sample의 `Button` 컴포넌트 design context를 조회합니다.

```sh
npx @hsskey/tokenloom context Button --from samples/button/snapshot.json --view agent --json
```

해당 컴포넌트의 구조, variant, token reference를 JSON으로 출력합니다.

같은 snapshot에서 CSS, Swift, Kotlin용 디자인 토큰을 생성합니다.

```sh
npx @hsskey/tokenloom tokens build --from samples/button/snapshot.json --out /tmp/tk --platform css,swift,kotlin
```

`/tmp/tk` 아래에 DTCG token document, CSS custom properties, Swift와 Kotlin source를 만듭니다.

`samples/` 아래에는 `real-design-system`, `four-modes`, `twenty-variants` 등 다른 snapshot도 있습니다.
`--from`에 각 디렉터리의 `snapshot.json` 경로를 지정하면 됩니다.

## 시작하기

### 1. tokenloom 설치

Node.js 22 이상이 필요합니다.

```sh
npm install -g @hsskey/tokenloom
```

작업 중인 프로젝트에서 Claude Code Skill을 설치합니다.

```sh
tokenloom init
```

이제 Claude Code가 tokenloom을 통해 Figma export에서 필요한 컴포넌트 맥락을 조회할 수 있습니다.

### 2. Figma 페이지 export

Figma Community에서 [**tokenloom exporter**](https://www.figma.com/community/plugin/1680544980365532256/tokenloom-exporter)
플러그인을 설치합니다.

구현하려는 컴포넌트가 있는 페이지에서 플러그인을 실행하고 snapshot을 내려받은 뒤, 작업 중인
프로젝트 안에 저장합니다.

예:

```text
my-app/
├── designs/
│   └── checkout.json
├── src/
└── ...
```

저장 위치에는 제약이 없습니다.

### 3. 컴포넌트 구현 요청

Claude Code에 snapshot과 구현할 컴포넌트를 알려줍니다.

> `designs/checkout.json`을 사용해서 Button 컴포넌트를 구현해줘.
> 이 프로젝트의 기존 컴포넌트와 스타일링 방식을 따르고, 기존 token을 재사용해줘.
> 구현 후 관련 테스트와 체크도 실행해줘.

Claude Code는 tokenloom을 사용해 해당 컴포넌트를 찾고 필요한 디자인 맥락을 조회한 뒤,
프로젝트의 기존 코드와 함께 참고해 컴포넌트를 구현합니다.

tokenloom 자체가 애플리케이션 코드를 생성하는 것은 아닙니다. tokenloom의 역할은 코딩 에이전트가
디자인을 이해하는 데 필요한 정보를 구조화해서 제공하는 것입니다.

## CLI에서 직접 사용하기

에이전트 없이 design context를 확인할 수도 있습니다.

```sh
tokenloom context Button \
  --from designs/checkout.json \
  --view agent \
  --json
```

특정 컴포넌트에 필요한 구조, variant, token reference 등의 맥락을 출력합니다.

## 디자인 토큰 생성

코딩 에이전트를 사용하지 않아도 같은 Figma export에서 디자인 토큰을 만들 수 있습니다.

```sh
tokenloom tokens build \
  --from designs/checkout.json \
  --out src/tokens \
  --platform css,swift,kotlin
```

다음을 생성합니다.

* DTCG token document
* CSS custom properties
* Swift source
* Kotlin source

같은 입력과 설정은 항상 같은 출력을 만듭니다.

## tokenloom이 하는 일

tokenloom은 Figma 데이터를 그대로 LLM에 넘기는 대신 일반 프로그램으로 처리할 수 있는 일을 먼저
수행합니다.

* Figma export를 공통 snapshot으로 읽습니다.
* 컴포넌트와 variant를 찾습니다.
* 코드 생성에 필요한 디자인 맥락을 구성합니다.
* 디자인 토큰을 DTCG와 플랫폼별 형식으로 변환합니다.
* 동일한 입력에 대해 결정적인 결과를 만듭니다.

코딩 에이전트는 그 결과와 실제 코드베이스의 컴포넌트 구조, 스타일링 방식, 프로젝트 규칙을 함께 보고
코드를 작성합니다.

## 역할 구분

**Figma plugin**

현재 열려 있는 Figma 페이지를 snapshot으로 export합니다.

**tokenloom**

snapshot을 읽고 컴포넌트 맥락과 디자인 토큰을 만듭니다.

**coding agent**

tokenloom이 제공한 디자인 정보와 실제 프로젝트 코드를 함께 읽고 컴포넌트를 구현합니다.

tokenloom은 `.fig` 파일 파서나 범용 UI 코드 생성기가 아니며, Figma 파일 전체를 그대로 LLM에
전달하는 도구도 아닙니다.

## Evaluation harness

위에서 다룬 tokenloom CLI(`snapshot`, `context`, `tokens`)는 로컬에서 결정적으로 동작하며 language
model을 호출하지 않습니다. 이 저장소에는 별도의 development evaluation harness가 함께 들어 있고,
실제 model call을 하는 부분은 이 harness뿐입니다. 배포되는 CLI workflow의 일부가 아니라 개발용
도구입니다. 목적은 design-context 표현 방식을 바꿨을 때 coding agent가 생성하는 컴포넌트와 그 생성에
드는 model usage가 어떻게 달라지는지 측정하는 것입니다.

### What it measures

* **S1 (token reference validity)** — 생성된 CSS가 파싱되고, 사용한 모든 `var(--x)`가 reference
  `tokens.css`에 존재하는지.
* **S2 (token compliance)** — 생성된 CSS에서 design-token reference 대 하드코딩 literal의 비율.
* **Variant coverage** — 요구되는 variant 집합과 생성된 HTML의 `data-variant` marker를 비교해 recall,
  precision과 함께 duplicate, missing, unexpected variant를 보고합니다. Coverage는 별도의 failure
  dimension이며 S1이나 S2에 합쳐지지 않습니다.
* **S3 (visual difference)** — reference render가 있는 expected variant마다 reference와 생성된 variant의
  pixel mismatch를 측정합니다. Gated value는 가장 나쁜 variant의 mismatch이고, mean은 diagnostic으로
  함께 기록합니다. reference render가 있는 expected variant가 없으면 S3는 not applicable입니다.
  Coverage와 S3는 서로 독립적인 failure dimension입니다.
* **Usage metrics** — run별 input/output token, cost estimate, latency, model provenance(요청한 alias와
  provider가 resolve한 model id).

### How results are recorded

* 각 run은 JSONL run record로 저장하고, report는 그 record에서 계산하며 숫자를 직접 입력하지 않습니다.
* run은 같은 prompt hash와 model provenance를 공유하는 집합 안에서만 비교합니다. prompt나 model이
  바뀌면 새로운 comparison set이 시작됩니다.
* threshold failure는 report에서 확인하며, threshold는 `eval/thresholds.json`에 있습니다.
* run record는 append-only이며 재작성하지 않습니다.

### Reproducing without spending money

model call 없이 trajectory evaluation을 계획합니다.

```sh
pnpm tokenloom eval trajectory --matrix eval/trajectory.yaml --dry-run --json
```

fake adapter로 one-shot evaluation을 계획합니다. 이 역시 model call을 하지 않습니다.

```sh
TOKENLOOM_LLM=fake pnpm tokenloom eval run --matrix eval/matrix.mvp.yaml --dry-run
```

committed run record에서 report를 다시 생성합니다(`runs/*.jsonl`을 읽고 model call은 하지 않습니다).

```sh
pnpm tokenloom eval report --out reports/<date>.md
```

committed report 예시는 [`reports/2026-09-17.md`](./reports/2026-09-17.md)이며, 실제 run record에서
계산한 S1, S2, token usage, cost, latency를 보여줍니다. 실제 model call은 fake adapter 없이 `eval run`
또는 `eval trajectory`를 실행할 때만 발생하고 명시적 budget이 필요합니다. 전체 계약은
[`docs/reference/spec.md`](./docs/reference/spec.md) section 9를 참고하세요.

## 문서

더 자세한 동작과 설계는 다음 문서에서 확인할 수 있습니다.

* [`docs/reference/spec.md`](./docs/reference/spec.md) — CLI와 데이터 계약
* [`docs/architecture.md`](./docs/architecture.md) — 모듈 경계와 데이터 흐름
* [`docs/adr/`](./docs/adr/) — 주요 설계 결정

## License

MIT
