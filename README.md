# Pi Agent Configuration

Pi Coding Agent의 개인 설정 및 확장 저장소입니다.

## Directory Structure

```
.pi/agent/
├── AGENTS.md           # 에이전트 동작 지침
├── settings.json       # 주요 설정 (모델, 프로바이더, 테마 등)
├── extensions/         # 커스텀 확장 기능
├── skills/             # 전문화된 작업 스킬
├── prompts/            # 프롬프트 템플릿
└── themes/             # UI 테마
```

## Settings

`settings.json`에서 주요 설정을 관리합니다:

| Setting | Value | Description |
|---------|-------|-------------|
| `defaultProvider` | `opencode` | 기본 AI 프로바이더 |
| `defaultModel` | `glm-5-free` | 기본 모델 |
| `defaultThinkingLevel` | `high` | 기본 사고 레벨 |
| `theme` | `gruvbox-dark` | UI 테마 |
| `quietStartup` | `true` | 조용한 시작 모드 |

## Extensions

### simple-ui.ts

세션 시작 시 footer에 모델 정보와 컨텍스트 사용량을 표시하는 UI 확장입니다.

- 현재 모델명 및 사고 레벨 표시
- 남은 컨텍스트 용량 퍼센트 표시 (30% 미만일 때 강조)

### websearch.ts

Exa AI를 사용한 웹 검색 도구입니다.

- 웹 검색 및 결과 반환
- 검색 타입: `auto`, `fast`, `deep`
- Live crawl 모드 지원
- 결과 트렁케이션 및 임시 파일 저장

### webfetch

URL에서 콘텐츠를 가져오는 도구입니다.

- 지원 포맷: `text`, `markdown`, `html`
- 이미지 지원: PNG, JPG, GIF, WebP
- HTML → Markdown 변환 (Turndown)
- 최대 5MB 응답 크기 제한

## Skills

### commit-message-guidelines

일관된 Git 커밋 메시지 작성을 위한 가이드라인입니다.

- 커밋 메시지 7가지 규칙
- 제목줄 50자 제한, 본문 72자 래핑
- 명령형 어조 사용 권장
- 커밋 타입 분류 (Add, Fix, Refactor 등)

### playwright-cli

Playwright CLI를 사용한 브라우저 자동화 스킬입니다.

- 브라우저 네비게이션 및 상호작용
- 스크린샷 및 PDF 생성
- 탭 관리 및 스토리지 상태 저장
- 네트워크 요청 모킹
- DevTools, Tracing, Video 녹화

### skill-creator

새로운 스킬을 설계하고 구현하기 위한 가이드입니다.

- 스킬 구조 및 원칙
- Progressive Disclosure 설계 패턴
- 스킬 생성 프로세스 (6단계)
- 패키징 및 배포

### deep-research

심층 연구 및 분석을 위한 워크플로우입니다.

- 8단계 연구 파이프라인 (Scope → Plan → Retrieve → Triangulate → Synthesize → Critique → Refine → Package)
- 모드 선택: `quick`, `standard`, `deep`, `ultradeep`
- 소스 신뢰도 평가 및 인용 추적
- Markdown/HTML/PDF 리포트 생성

## Prompts

### git-commit.md

Git 커밋 생성을 위한 프롬프트 템플릿입니다.

- `commit-message-guidelines` 스킬 로드
- 현재 Git 상태 확인
- 스테이지된 변경사항 커밋

## Themes

### gruvbox-dark.json

Gruvbox 다크 컬러 스킴 테마입니다.

- 따뜻한 어두운 배경색
- 구문 강조 색상 정의
- 마크다운, diff, 도구 출력 스타일

## Usage

이 저장소는 Pi Coding Agent의 사용자 설정 디렉토리입니다. 자동으로 로드되며, 확장, 스킬, 프롬프트, 테마를 커스터마이징할 수 있습니다.

자세한 내용은 [Pi Documentation](https://github.com/badlogic/pi-mono)을 참조하세요.
