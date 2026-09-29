<h1 align="center">tokenloom</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@hsskey/tokenloom"
    ><img alt="npm" src="https://img.shields.io/npm/v/@hsskey/tokenloom?style=flat-square"
  /></a>
  <a href="./LICENSE"
    ><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"
  /></a>
  <img alt="Node >= 22" src="https://img.shields.io/badge/node-%3E%3D22-blue?style=flat-square" />
</p>

<h3 align="center">컴포넌트 구현에 필요한 Figma 맥락만 코딩 에이전트에 전달합니다.</h3>

<p align="center"><a href="./README.md">English</a></p>

tokenloom은 Figma 페이지 export를 컴포넌트 단위 design context와 재사용 가능한 디자인 토큰으로 변환합니다.
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

## tokenloom을 쓰는 이유

- **필요한 맥락만.** 에이전트가 Figma 노드 트리 전체를 훑는 대신, tokenloom이 대상 컴포넌트와 variant를 찾아 그 부분만 전달합니다.
- **결정적이고 로컬.** 같은 입력과 설정은 항상 같은 출력을 만들며, CLI 경로에서는 model call이 없습니다.
- **실제 플랫폼용 토큰.** export 하나가 DTCG token document와 CSS custom properties, Swift, Kotlin source가 됩니다.
- **에이전트 연동.** Claude Code Skill을 설치하면 에이전트가 구현 중에 직접 컴포넌트 맥락을 조회합니다.

## Quick Start

Node.js 22 이상이 필요합니다.

Figma 없이 tokenloom을 처음부터 끝까지 실행해 볼 수 있습니다. `samples/` 아래에 sample snapshot이 들어
있어 `npx`로 배포된 패키지를 바로 돌려볼 수 있습니다. 저장소를 clone한 뒤 루트에서 sample의 `Button`
컴포넌트 design context를 조회합니다.

```sh
npx @hsskey/tokenloom context Button --from samples/button/snapshot.json --view agent --json
```

해당 컴포넌트의 구조, variant, token reference를 JSON으로 출력합니다. 같은 snapshot에서 CSS, Swift,
Kotlin용 디자인 토큰을 생성합니다.

```sh
npx @hsskey/tokenloom tokens build --from samples/button/snapshot.json --out /tmp/tk --platform css,swift,kotlin
```

`samples/` 아래에는 `real-design-system`, `four-modes`, `twenty-variants` 등 다른 snapshot도 있습니다.
`--from`에 각 디렉터리의 `snapshot.json` 경로를 지정하면 됩니다.

## Claude Code와 함께 사용하기

CLI를 전역 설치한 뒤 작업 중인 프로젝트에 Claude Code Skill을 설치합니다.

```sh
npm install -g @hsskey/tokenloom
tokenloom init
```

작업할 페이지를 export합니다. Figma Community에서
[**tokenloom exporter**](https://www.figma.com/community/plugin/1680544980365532256/tokenloom-exporter)
플러그인을 설치하고, 컴포넌트가 있는 페이지에서 실행한 뒤 내려받은 snapshot을 프로젝트 안에 저장합니다
(예: `designs/checkout.json`, 저장 위치에는 제약이 없습니다).

그다음 Claude Code에 snapshot과 구현할 컴포넌트를 알려줍니다.

> `designs/checkout.json`을 사용해서 Button 컴포넌트를 구현해줘.
> 이 프로젝트의 기존 컴포넌트와 스타일링 방식을 따르고, 기존 token을 재사용해줘.
> 구현 후 관련 테스트와 체크도 실행해줘.

Claude Code는 tokenloom으로 컴포넌트를 찾아 design context를 조회한 뒤, 프로젝트의 기존 코드와 함께
참고해 컴포넌트를 구현합니다. tokenloom 자체가 애플리케이션 코드를 작성하지는 않습니다. 에이전트가
참고할 구조화된 디자인 정보를 제공하는 것이 역할입니다.

## CLI에서 직접 사용하기

에이전트 없이 컴포넌트 맥락을 확인합니다.

```sh
tokenloom context Button --from designs/checkout.json --view agent --json
```

에이전트 없이 디자인 토큰을 생성합니다.

```sh
tokenloom tokens build --from designs/checkout.json --out src/tokens --platform css,swift,kotlin
```

DTCG token document, CSS custom properties, Swift와 Kotlin source를 만듭니다. 같은 입력과 설정은 항상
같은 출력을 만듭니다.

## 역할 구분

- **Figma plugin** - 현재 열려 있는 Figma 페이지를 snapshot으로 export합니다.
- **tokenloom** - snapshot을 읽고 컴포넌트 맥락과 디자인 토큰을 만듭니다.
- **coding agent** - 그 디자인 정보와 기존 프로젝트 코드를 함께 보고 컴포넌트를 구현합니다.

tokenloom은 `.fig` 파일 파서나 범용 UI 코드 생성기가 아니며, Figma 파일 전체를 그대로 LLM에 전달하지도
않습니다.

## Evaluation harness

위 CLI는 로컬에서 결정적으로 동작하며 language model을 호출하지 않습니다. 이 저장소에는 design-context
표현 방식을 바꿨을 때 에이전트가 생성하는 컴포넌트와 그에 드는 model usage가 어떻게 달라지는지 측정하는
별도의 development evaluation harness가 함께 들어 있습니다. 배포되는 CLI의 일부가 아닌 개발용 도구이며,
실제 model call을 하는 부분은 이 harness뿐이고 명시적 budget이 필요합니다. 전체 계약은
[`docs/reference/spec.md`](./docs/reference/spec.md) section 9를, 실제 run record로 계산한 예시 report는
[`reports/2026-09-17.md`](./reports/2026-09-17.md)를 참고하세요.

## 문서

- [`docs/reference/spec.md`](./docs/reference/spec.md) - CLI와 데이터 계약
- [`docs/architecture.md`](./docs/architecture.md) - 모듈 경계와 데이터 흐름
- [`docs/adr/`](./docs/adr/) - 주요 설계 결정

## License

MIT
