import os
import json


def summarize(responses, n, api_key=None):
    try:
        import anthropic
    except ImportError:
        raise RuntimeError(
            "anthropic package not installed — run: pip install anthropic"
        )

    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "No API key provided — set one in the widget settings or via ANTHROPIC_API_KEY"
        )

    client = anthropic.Anthropic(api_key=api_key)
    numbered = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(responses))

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Analyze these {len(responses)} survey responses and produce exactly {n} "
                    f"distinct thematic summaries.\n\nResponses:\n{numbered}\n\n"
                    f"Return ONLY a JSON array of exactly {n} objects, each with:\n"
                    '- "summary": 1-3 sentence description of a theme or perspective\n'
                    '- "num_respondents": integer estimate of how many respondents share this view\n'
                    "No other text, no markdown fences."
                ),
            }
        ],
    )

    data = json.loads(message.content[0].text.strip())
    return [(item["summary"], int(item["num_respondents"])) for item in data]
