import re
from dataclasses import dataclass

import anthropic

from app.config import ANTHROPIC_API_KEY, CLAUDE_MODEL, MAX_TOKENS, get_system_prompt
from app.github import ChartInfo


@dataclass
class GeneratedFile:
    filename: str
    language: str
    content: str


def build_user_message(chart: ChartInfo, guidance: str = "") -> str:
    """Build the user message for Claude from chart info."""
    parts = [
        "I have a Helm chart that I want to deploy via Nuon BYOC.",
        "",
        "## Chart.yaml",
        "```yaml",
        chart.chart_yaml,
        "```",
    ]

    if chart.values_yaml:
        parts.extend([
            "",
            "## values.yaml",
            "```yaml",
            chart.values_yaml,
            "```",
        ])

    parts.extend([
        "",
        "## Chart Source",
        f"This chart is from GitHub: {chart.org}/{chart.repo} "
        f"at directory `{chart.directory}` on branch `{chart.branch}`.",
    ])

    if guidance:
        parts.extend(["", "## Additional Guidance", guidance])

    parts.extend([
        "",
        "Generate a complete Nuon app configuration for this Helm chart. Include:",
        "1. metadata.toml",
        "2. inputs.toml (classify values.yaml entries into customer inputs vs hardcoded defaults)",
        "3. Component TOML file(s)",
        "4. Templated values file",
        "5. Any infrastructure components needed (RDS, certificates, etc.)",
        "6. Actions for credential provisioning if databases are involved",
        "",
        "Output each file with a clear filename header like:",
        "### metadata.toml",
        "```toml",
        "...",
        "```",
    ])

    return "\n".join(parts)


async def generate_config(chart: ChartInfo, guidance: str = "") -> str:
    """Call Claude API and return the full response text."""
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    system_prompt = get_system_prompt()
    user_message = build_user_message(chart, guidance)

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    return message.content[0].text


def parse_files(response_text: str) -> list[GeneratedFile]:
    """Parse Claude's response into individual files."""
    pattern = r"###\s+(.+?)\s*\n```(\w+)\n(.*?)```"
    matches = re.findall(pattern, response_text, re.DOTALL)

    files = []
    for filename, language, content in matches:
        files.append(GeneratedFile(
            filename=filename.strip(),
            language=language.strip(),
            content=content.strip(),
        ))

    return files
