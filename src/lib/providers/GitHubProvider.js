import axios from 'axios';

export class GitHubProvider {
  constructor() {
    this.baseURL = 'https://api.github.com';
    this.token = process.env.GITHUB_TOKEN;
  }

  async getDeployments(repo, days = 30) {
    const deployments = [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    try {
      // Determine deployment method
      switch (repo.deploymentMethod) {
        case 'releases':
          const releases = await this.getReleases(repo, since);
          deployments.push(...releases);
          break;
        
        case 'tags':
          const tags = await this.getTags(repo, since);
          deployments.push(...tags);
          break;
        
        case 'workflow':
        case 'workflows':
          const workflows = await this.getWorkflowRuns(repo, since);
          deployments.push(...workflows);
          break;
        
        default:
          // Try releases first, then tags as fallback
          const defaultReleases = await this.getReleases(repo, since);
          if (defaultReleases.length > 0) {
            deployments.push(...defaultReleases);
          } else {
            const defaultTags = await this.getTags(repo, since);
            deployments.push(...defaultTags);
          }
      }

      return deployments;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Repository not found or not accessible: ${repo.owner}/${repo.name}`);
      } else if (error.response?.status === 403) {
        throw new Error('GitHub API rate limit exceeded or insufficient permissions');
      }
      throw error;
    }
  }

  async getReleases(repo, since) {
    const url = `${this.baseURL}/repos/${repo.owner}/${repo.name}/releases`;
    const headers = this.token ? { Authorization: `token ${this.token}` } : {};

    const response = await axios.get(url, { 
      headers,
      params: { per_page: 100 }
    });

    return response.data
      .filter(release => new Date(release.created_at) >= new Date(since))
      .map(release => ({
        id: `release-${release.id}`,
        type: 'release',
        date: release.created_at,
        commit_sha: release.target_commitish,
        tag_name: release.tag_name,
        branch: release.target_commitish,
        status: release.draft ? 'draft' : 'published',
        environment: release.prerelease ? 'pre-release' : 'production'
      }));
  }

  async getTags(repo, since) {
    const url = `${this.baseURL}/repos/${repo.owner}/${repo.name}/tags`;
    const headers = this.token ? { Authorization: `token ${this.token}` } : {};

    const response = await axios.get(url, { 
      headers,
      params: { per_page: 100 }
    });

    // Note: GitHub API doesn't provide tag creation date directly
    // We'll need to get commit info for each tag to filter by date
    const tags = [];
    
    for (const tag of response.data.slice(0, 20)) { // Limit to avoid too many API calls
      try {
        const commitUrl = `${this.baseURL}/repos/${repo.owner}/${repo.name}/commits/${tag.commit.sha}`;
        const commitResponse = await axios.get(commitUrl, { headers });
        const commitDate = commitResponse.data.commit.author.date;
        
        if (new Date(commitDate) >= new Date(since)) {
          tags.push({
            id: `tag-${tag.name}`,
            type: 'tag',
            date: commitDate,
            commit_sha: tag.commit.sha,
            tag_name: tag.name,
            branch: repo.branch || 'main',
            status: 'success',
            environment: 'production'
          });
        }
      } catch (error) {
        // Skip this tag if we can't get commit info
        continue;
      }
    }

    return tags;
  }

  async getWorkflowRuns(repo, since) {
    const url = `${this.baseURL}/repos/${repo.owner}/${repo.name}/actions/runs`;
    const headers = this.token ? { Authorization: `token ${this.token}` } : {};

    const response = await axios.get(url, { 
      headers,
      params: { 
        per_page: 100,
        status: 'completed',
        event: 'push',
        branch: repo.branch || 'main'
      }
    });

    return response.data.workflow_runs
      .filter(run => new Date(run.created_at) >= new Date(since))
      .filter(run => run.conclusion === 'success') // Only successful deployments
      .map(run => ({
        id: `workflow-${run.id}`,
        type: 'workflow',
        date: run.created_at,
        commit_sha: run.head_sha,
        tag_name: null,
        branch: run.head_branch,
        status: run.conclusion,
        environment: run.head_branch === (repo.branch || 'main') ? 'production' : 'staging'
      }));
  }

  async getPullRequests(repo, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const url = `${this.baseURL}/repos/${repo.owner}/${repo.name}/pulls`;
    const headers = this.token ? { Authorization: `token ${this.token}` } : {};

    const response = await axios.get(url, { 
      headers,
      params: { 
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 100
      }
    });

    const pullRequests = [];

    for (const pr of response.data) {
      // Skip if not merged or outside date range
      if (!pr.merged_at || new Date(pr.merged_at) < new Date(since)) {
        continue;
      }

      try {
        // Get detailed PR info including commits
        const prDetailUrl = `${this.baseURL}/repos/${repo.owner}/${repo.name}/pulls/${pr.number}`;
        const prDetail = await axios.get(prDetailUrl, { headers });

        // Get commits for this PR to find first commit date
        const commitsUrl = `${this.baseURL}/repos/${repo.owner}/${repo.name}/pulls/${pr.number}/commits`;
        const commitsResponse = await axios.get(commitsUrl, { headers });
        
        const commits = commitsResponse.data;
        const firstCommit = commits[0];
        const lastCommit = commits[commits.length - 1];

        pullRequests.push({
          pr_number: pr.number,
          pr_id: `github-pr-${pr.id}`,
          title: pr.title,
          author: pr.user?.login || 'unknown',
          created_at_pr: pr.created_at,
          merged_at: pr.merged_at,
          closed_at: pr.closed_at,
          first_commit_at: firstCommit?.commit?.author?.date || pr.created_at,
          last_commit_at: lastCommit?.commit?.author?.date || pr.created_at,
          base_branch: pr.base?.ref || 'main',
          head_branch: pr.head?.ref || 'unknown',
          head_sha: pr.head?.sha,
          merge_sha: pr.merge_commit_sha,
          state: pr.state,
          is_merged: !!pr.merged_at,
          lines_added: prDetail.data.additions || 0,
          lines_deleted: prDetail.data.deletions || 0,
          commits_count: prDetail.data.commits || commits.length
        });

        // Rate limiting protection
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.warn(`Warning: Could not fetch details for PR #${pr.number}: ${error.message}`);
        // Add PR with basic info only
        pullRequests.push({
          pr_number: pr.number,
          pr_id: `github-pr-${pr.id}`,
          title: pr.title,
          author: pr.user?.login || 'unknown',
          created_at_pr: pr.created_at,
          merged_at: pr.merged_at,
          closed_at: pr.closed_at,
          first_commit_at: pr.created_at,
          last_commit_at: pr.created_at,
          base_branch: pr.base?.ref || 'main',
          head_branch: pr.head?.ref || 'unknown',
          head_sha: pr.head?.sha,
          merge_sha: pr.merge_commit_sha,
          state: pr.state,
          is_merged: !!pr.merged_at,
          lines_added: 0,
          lines_deleted: 0,
          commits_count: 0
        });
      }
    }

    return pullRequests;
  }
}
