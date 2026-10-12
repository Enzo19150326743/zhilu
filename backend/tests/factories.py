"""仅供测试使用的合成媒体数据。"""

from app.schemas import ParseResponse


def build_parse_response(video_url: str) -> ParseResponse:
    """
    构造可按场景覆盖字段的测试数据。
    """
    return ParseResponse(
        source_url=video_url,
        is_placeholder=True,
        video={
            "video_id": "placeholder_parse_result",
            "platform": "placeholder",
            "url": video_url,
            "title": "媒体解析暂未完成",
            "author": "知录本地解析",
            "duration": 0,
            "thumbnail": "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
            "has_transcript": False,
            "media_type": "media",
            "text_source_type": "content",
        },
        formats=[
            {
                "format_id": "placeholder-format",
                "ext": "mp4",
                "resolution": "待解析",
                "vcodec": "待接入",
                "acodec": "待接入",
                "filesize": None,
                "label": "真实格式待接入",
            }
        ],
        transcript={
            "segments": [
                {
                    "start": 0,
                    "end": 0,
                    "text": "当前链接已通过基础校验，但暂时没有取得可用媒体内容。",
                }
            ],
            "plain_text": "当前链接已通过基础校验，但暂时没有取得可用媒体内容。",
        },
        summary={
            "tldr": "当前链接暂时没有解析出可用媒体内容，请稍后重试或换一个公开链接。",
            "key_points": [
                "链接格式已通过基础校验。",
                "当前没有取得可用于总结的标题、内容文本或下载格式。",
                "拿到内容文本后，再生成结构化总结、摘录和导图。",
            ],
            "timeline": [],
            "structured_analysis_markdown": "## 当前状态\n### 链接已接收\n系统已完成基础校验。\n### 暂未取得内容\n请确认链接公开可访问，或稍后重新解析。",
            "takeaways": [
                "优先使用公开可访问、带标题和内容文本的媒体链接。",
                "平台临时限制访问时，可以稍后重试。",
            ],
        },
        mindmap_markdown="# 媒体解析\n## 当前状态\n### 链接已接收\n## 下一步\n### 重新解析公开可访问链接",
    )
