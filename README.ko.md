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

Figma Community에서 **tokenloom exporter** 플러그인을 설치합니다.

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

## 문서

더 자세한 동작과 설계는 다음 문서에서 확인할 수 있습니다.

* [`docs/reference/spec.md`](./docs/reference/spec.md) — CLI와 데이터 계약
* [`docs/architecture.md`](./docs/architecture.md) — 모듈 경계와 데이터 흐름
* [`docs/adr/`](./docs/adr/) — 주요 설계 결정

## License

MIT
