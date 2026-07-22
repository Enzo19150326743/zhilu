import type { DemoDetail, DemoItem } from "./types";

export const mockDemos: DemoItem[] = [
  {
    demo_id: "ai_talk_001",
    title: "从 LLM 到 Agent Skill：打通底层逻辑",
    description: "马克的技术工作坊 · B 站",
    thumbnail: "/demo-covers/ai-talk.svg"
  },
  {
    demo_id: "product_course_001",
    title: "Agent 的下一步：从个人助手走向组织能力",
    description: "晓辉博士 · 抖音",
    thumbnail: "/demo-covers/product-course.svg"
  },
  {
    demo_id: "tech_podcast_001",
    title: "我祝福你永远自由地航行",
    description: "付宇_KlTr · 小宇宙播客",
    thumbnail: "/demo-covers/tech-podcast.svg"
  }
];

export const mockDemoDetails: Record<string, DemoDetail> = {
  ai_talk_001: {
    success: true,
    video: {
      video_id: "featured_BV1E7wtzaEdq",
      platform: "bilibili",
      url: "https://www.bilibili.com/video/BV1E7wtzaEdq",
      title: "从 LLM 到 Agent Skill，一期视频带你打通底层逻辑！",
      author: "马克的技术工作坊",
      duration: 1951,
      thumbnail: mockDemos[0].thumbnail,
      has_transcript: true,
      media_type: "video",
      text_source_type: "curated_excerpt"
    },
    formats: [],
    transcript: {
      segments: [
        {
          start: 1147,
          end: 1164,
          text: "Tool 的本质，是给大模型提供一套可以调用的外部能力，让它能够感知和影响外部环境。"
        },
        {
          start: 1740,
          end: 1763,
          text: "Agent Skill 本质上是一份给 Agent 看的说明文档，用来规定做事的步骤和规则。"
        }
      ],
      plain_text:
        "Tool 的本质，是给大模型提供一套可以调用的外部能力，让它能够感知和影响外部环境。\nAgent Skill 本质上是一份给 Agent 看的说明文档，用来规定做事的步骤和规则。"
    },
    summary: {
      content_type: "视频",
      topics: ["大语言模型", "Agent", "工具协议"],
      tldr:
        "从底层工程视角拆解 LLM、Token、Context、Prompt、Tool、MCP、Agent 和 Agent Skill，建立理解 AI 技术栈的完整框架。",
      key_points: [
        "LLM 通过逐个预测下一个 Token 生成回答，Token 是模型处理文本的基本单元。",
        "Context 决定模型每次处理任务时能看到的信息，Prompt 则定义任务和行为规则。",
        "Tool 扩展模型影响外部环境的能力，MCP 为不同工具提供统一接入协议。",
        "Agent 能持续规划和调用工具，Agent Skill 则用文档约束其步骤与规则。"
      ],
      timeline: [],
      structured_analysis_markdown:
        "## 核心概念\n### LLM、Token 与 Context\n模型在上下文窗口内，根据 Token 序列持续预测输出。\n### Prompt 与 Tool\nPrompt 规定任务，Tool 让模型能够调用外部能力。\n### MCP、Agent 与 Agent Skill\nMCP 统一工具接入，Agent 负责规划执行，Skill 负责沉淀可复用的工作规则。",
      takeaways: [
        "用一条概念链理解 AI 技术栈各层之间的关系。",
        "设计 Agent 前，先区分模型、工具、协议和行为规则。",
        "把稳定工作方法写成 Agent 可读取的说明文档。"
      ],
      highlights: [
        {
          id: "featured-ai-skill-quote-1",
          text: "Tool 的本质，是给大模型提供一套可以调用的外部能力，让它能够感知和影响外部环境。",
          start: 1147,
          end: 1164,
          reason: "概括 Tool 在 AI 系统中的核心作用。",
          tags: ["Tool"],
          source: "ai",
          source_type: "curated_excerpt"
        },
        {
          id: "featured-ai-skill-quote-2",
          text: "Agent Skill 本质上是一份给 Agent 看的说明文档，用来规定做事的步骤和规则。",
          start: 1740,
          end: 1763,
          reason: "直接说明 Agent Skill 的定位。",
          tags: ["Agent Skill"],
          source: "ai",
          source_type: "curated_excerpt"
        }
      ]
    },
    mindmap_markdown:
      "# 从 LLM 到 Agent Skill\n## LLM\n### Token 预测\n### Transformer\n## Context\n### 上下文窗口\n### 对话历史\n## Prompt\n### 任务指令\n### 行为规则\n## Tool 与 MCP\n### 外部能力\n### 统一协议\n## Agent\n### 自主规划\n### 工具调用\n## Agent Skill\n### 说明文档\n### 可复用规则"
  },
  product_course_001: {
    success: true,
    video: {
      video_id: "featured_douyin_7663153637631210149",
      platform: "douyin",
      url: "https://www.douyin.com/video/7663153637631210149",
      title: "Agent 的下一步：从个人助手走向组织能力",
      author: "晓辉博士",
      duration: 375,
      thumbnail: mockDemos[1].thumbnail,
      has_transcript: true,
      media_type: "video",
      text_source_type: "curated_excerpt"
    },
    formats: [],
    transcript: {
      segments: [
        {
          start: 184,
          end: 207,
          text: "角色、目标、规则、资源、关系和状态，有了这六个要素之后，才能基于情境判断下一步做什么。"
        },
        {
          start: 331,
          end: 339,
          text: "这套体系不光对 AI 有用，对我们每个人重新审视自己的工作也是有用的。"
        }
      ],
      plain_text:
        "角色、目标、规则、资源、关系和状态，有了这六个要素之后，才能基于情境判断下一步做什么。\n这套体系不光对 AI 有用，对我们每个人重新审视自己的工作也是有用的。"
    },
    summary: {
      content_type: "视频",
      topics: ["Agent", "组织能力", "情境感知"],
      tldr:
        "讨论 AI Agent 不通过人直接进入组织时所需的情境感知能力，并用新员工入职类比出六项必要上下文。",
      key_points: [
        "Agent 从个人助手走向组织成员，需要理解所在环境，而不只是接受人的单次指令。",
        "情境感知由角色、目标、规则、资源、关系和状态六项上下文构成。",
        "组织需要判断向 Agent 开放哪些上下文、权限和协作关系。",
        "这套框架也能帮助个人重新审视自己的工作结构。"
      ],
      timeline: [],
      structured_analysis_markdown:
        "## 核心问题\nAI Agent 如果不通过人作为媒介，如何直接进入组织并做出判断？\n## 情境感知六要素\n### 角色与目标\n明确职能定位和组织预期。\n### 规则与资源\n了解制度边界和可用支持。\n### 关系与状态\n识别协作网络和当前进展。\n## 组织启示\nAgent 的价值取决于组织能否提供必要且受控的上下文。",
      takeaways: [
        "用六要素检查 Agent 是否真正理解组织情境。",
        "在开放上下文前，同时设计权限和信息边界。",
        "用同一框架复盘个人的工作环境。"
      ],
      highlights: [
        {
          id: "featured-context-quote-1",
          text: "角色、目标、规则、资源、关系和状态，有了这六个要素之后，才能基于情境判断下一步做什么。",
          start: 184,
          end: 207,
          reason: "给出情境感知能力的核心检查清单。",
          tags: ["Context Awareness"],
          source: "ai",
          source_type: "curated_excerpt"
        },
        {
          id: "featured-context-quote-2",
          text: "这套体系不光对 AI 有用，对我们每个人重新审视自己的工作也是有用的。",
          start: 331,
          end: 339,
          reason: "将组织 Agent 框架延伸到个人工作反思。",
          tags: ["工作反思"],
          source: "ai",
          source_type: "curated_excerpt"
        }
      ]
    },
    mindmap_markdown:
      "# Agent 的组织情境感知\n## 角色\n### 职能定位\n## 目标\n### 组织预期\n## 规则\n### 制度边界\n## 资源\n### 预算与专家\n## 关系\n### 汇报与协作\n## 状态\n### 当前进展\n## 组织行动\n### 开放必要上下文\n### 管理权限边界"
  },
  tech_podcast_001: {
    success: true,
    video: {
      video_id: "featured_xiaoyuzhou_69e7875e1d989496e72d7216",
      platform: "xiaoyuzhou",
      url: "https://www.xiaoyuzhoufm.com/episode/69e7875e1d989496e72d7216",
      title: "我不想祝福你安稳度过人生的「奥德赛时期」，我祝福你永远自由地航行",
      author: "付宇_KlTr",
      duration: 3957,
      thumbnail: mockDemos[2].thumbnail,
      has_transcript: true,
      media_type: "podcast",
      text_source_type: "curated_excerpt"
    },
    formats: [],
    transcript: {
      segments: [
        {
          start: 987,
          end: 1018,
          text: "并不是因为你还没长大，而是因为时代变了。我们脚底下踩着的土地不再是水泥地，而变成了摇晃的甲板。"
        },
        {
          start: 3457,
          end: 3494,
          text: "真正值得怀疑的，是所谓主流、所谓正轨的存在。也许更重要的是重新发明一套关于理想生活的叙事。"
        }
      ],
      plain_text:
        "并不是因为你还没长大，而是因为时代变了。我们脚底下踩着的土地不再是水泥地，而变成了摇晃的甲板。\n真正值得怀疑的，是所谓主流、所谓正轨的存在。也许更重要的是重新发明一套关于理想生活的叙事。"
    },
    summary: {
      content_type: "播客",
      topics: ["奥德赛时期", "个体化", "人生叙事"],
      tldr:
        "把“奥德赛时期”放回社会学和历史语境：年轻人的漂泊不只是成年延迟，而是旧人生脚本失效后，对新生活叙事的持续探索。",
      key_points: [
        "2007 年语境中的奥德赛时期偏向主动推迟成年，而今天更多伴随结构性不稳定。",
        "现代社会把职业、关系和风险不断下沉到个人，使结构性问题常被解释成个人能力问题。",
        "命名漂泊阶段能提供共享叙事，让处于过渡状态的人获得理解和表达。",
        "真正需要质疑的不是何时回归正轨，而是是否存在唯一的主流人生脚本。"
      ],
      timeline: [],
      structured_analysis_markdown:
        "## 概念来源\n“奥德赛时期”最初描述年轻人主动推迟传统成年节点。\n## 时代变化\n今天的漂泊同时受到行业、城市、关系和制度风险的影响。\n## 社会学解释\n个体化让人拥有更多选择，也让结构性风险更多由个人承担。\n## 叙事价值\n新的命名让过渡状态被看见，但不应只是把回归传统正轨的期限向后推迟。\n## 最终追问\n与其等待抵达唯一终点，不如重新定义值得叙述和实践的生活。",
      takeaways: [
        "区分个人选择与结构性环境，减少对迷茫的单一道德判断。",
        "把人生阶段的命名当作理解工具，而不是新的标准答案。",
        "持续探索能成立的生活叙事，而不是只等待回到所谓正轨。"
      ],
      highlights: [
        {
          id: "featured-odyssey-quote-1",
          text: "并不是因为你还没长大，而是因为时代变了。我们脚底下踩着的土地不再是水泥地，而变成了摇晃的甲板。",
          start: 987,
          end: 1018,
          reason: "把个人迷茫放回时代结构中理解。",
          tags: ["时代变化"],
          source: "ai",
          source_type: "curated_excerpt"
        },
        {
          id: "featured-odyssey-quote-2",
          text: "真正值得怀疑的，是所谓主流、所谓正轨的存在。也许更重要的是重新发明一套关于理想生活的叙事。",
          start: 3457,
          end: 3494,
          reason: "指出节目对线性人生脚本的核心反思。",
          tags: ["人生叙事"],
          source: "ai",
          source_type: "curated_excerpt"
        }
      ]
    },
    mindmap_markdown:
      "# 奥德赛时期与人生叙事\n## 概念来源\n### 主动推迟成年\n### 探索不同道路\n## 当代变化\n### 结构性不稳定\n### 旧脚本失效\n## 个体化\n### 选择增加\n### 风险下沉\n## 叙事的作用\n### 命名过渡状态\n### 获得共享理解\n## 核心反思\n### 质疑唯一正轨\n### 重新定义理想生活\n### 保持自由航行"
  }
};
