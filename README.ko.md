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

Figma 없이 30초 안에 tokenloom을 처음부터 끝까지 실행할 수 있습니다. 이 저장소는 `samples/` 아래에
sample snapshot을 포함하므로, `npx`로 배포된 패키지를 그 snapshot에 바로 실행하면 됩니다.
Node.js 22 이상이 필요합니다.

이 저장소를 clone한 뒤, 루트에서 bundled sample의 `Button` 컴포넌트 design context를 조회합니다.

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

**tokenloom exporter** 플러그인은 Figma Community 심사 중이며 아직 공개 설치할 수 없습니다.
공개 전까지는 `samples/` 아래의 bundled snapshot으로 Figma 없이 tokenloom을 실행하세요
([바로 실행해보기](#바로-실행해보기) 참고).

지금 Figma 전체 흐름을 확인하려면 exporter를 소스에서 빌드해 Figma desktop app에 직접 로드합니다.
`packages/adapters/plugin`을 빌드한 뒤, Figma에서 **Plugins > Development > Import plugin from
manifest**를 선택하고 그 패키지의 `manifest.json`을 지정합니다.

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
