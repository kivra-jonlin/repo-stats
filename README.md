# Repository Stats Counter

A Node.js application to track and count deployments from multiple git repositories.

## Features

- Track deployments from multiple repositories
- **Lead Time for Changes** - DORA metric tracking from commit to production
- Support for GitHub, GitLab, and other git hosting platforms
- Count deployments by tags, branches, or CI/CD events
- Pull Request analysis with merge time tracking
- Store statistics in local SQLite database
- Performance categorization (Elite, High, Medium, Low)
- Generate reports and export data
- CLI interface for easy usage

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure your repositories:
```bash
npm run config
```

3. Set up environment variables in `.env` file:
```
GITHUB_TOKEN=your_github_token_here
GITLAB_TOKEN=your_gitlab_token_here
```

## Usage

### Count deployments from all configured repositories:
```bash
npm start
```

### View current statistics:
```bash
npm run stats
```

### Configure repositories:
```bash
npm run config
```

### Track Lead Time for Changes (DORA Metric):
```bash
# Collect PR data and calculate lead time
npm run leadtime

# Show lead time with insights and recommendations
npm run leadtime:insights

# Just collect PR data without calculating lead time
npm run pull-requests

# Analyze specific repository
npm run leadtime -- --repo my-repo
```

## Configuration

The application uses a `config.json` file to store repository configurations. Each repository can be configured with:

- Repository URL or API endpoint
- Authentication tokens
- Deployment detection method (tags, branches, CI/CD)
- Time range for counting

## API Support

- **GitHub**: Uses GitHub REST API to fetch releases, tags, and workflow runs
- **GitLab**: Uses GitLab API to fetch deployments and pipeline events
- **Local Git**: Can analyze local git repositories

## Output

The application provides deployment statistics including:
- Total deployment count per repository
- Deployment frequency over time
- Success/failure rates (if available)
- Export options (JSON, CSV, console table)
