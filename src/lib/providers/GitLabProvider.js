import axios from 'axios';

export class GitLabProvider {
  constructor() {
    this.baseURL = 'https://gitlab.com/api/v4';
    this.token = process.env.GITLAB_TOKEN;
  }

  async getDeployments(repo, days = 30) {
    const deployments = [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    try {
      // Get project ID first
      const projectId = await this.getProjectId(repo);

      switch (repo.deploymentMethod) {
        case 'releases':
          const releases = await this.getReleases(projectId, since);
          deployments.push(...releases);
          break;
        
        case 'tags':
          const tags = await this.getTags(projectId, since);
          deployments.push(...tags);
          break;
        
        case 'pipeline':
        case 'pipelines':
          const pipelines = await this.getPipelines(projectId, since);
          deployments.push(...pipelines);
          break;
        
        default:
          // Try deployments API first, then releases
          const gitlabDeployments = await this.getGitLabDeployments(projectId, since);
          if (gitlabDeployments.length > 0) {
            deployments.push(...gitlabDeployments);
          } else {
            const defaultReleases = await this.getReleases(projectId, since);
            deployments.push(...defaultReleases);
          }
      }

      return deployments;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Repository not found or not accessible: ${repo.owner}/${repo.name}`);
      } else if (error.response?.status === 403) {
        throw new Error('GitLab API access denied or insufficient permissions');
      }
      throw error;
    }
  }

  async getProjectId(repo) {
    const projectPath = `${repo.owner}/${repo.name}`;
    const encodedPath = encodeURIComponent(projectPath);
    const url = `${this.baseURL}/projects/${encodedPath}`;
    const headers = this.token ? { 'Private-Token': this.token } : {};

    const response = await axios.get(url, { headers });
    return response.data.id;
  }

  async getGitLabDeployments(projectId, since) {
    const url = `${this.baseURL}/projects/${projectId}/deployments`;
    const headers = this.token ? { 'Private-Token': this.token } : {};

    const response = await axios.get(url, { 
      headers,
      params: { 
        per_page: 100,
        order_by: 'created_at',
        sort: 'desc'
      }
    });

    return response.data
      .filter(deployment => new Date(deployment.created_at) >= new Date(since))
      .map(deployment => ({
        id: `deployment-${deployment.id}`,
        type: 'deployment',
        date: deployment.created_at,
        commit_sha: deployment.sha,
        tag_name: deployment.tag,
        branch: deployment.ref,
        status: deployment.status,
        environment: deployment.environment.name
      }));
  }

  async getReleases(projectId, since) {
    const url = `${this.baseURL}/projects/${projectId}/releases`;
    const headers = this.token ? { 'Private-Token': this.token } : {};

    const response = await axios.get(url, { 
      headers,
      params: { per_page: 100 }
    });

    return response.data
      .filter(release => new Date(release.created_at) >= new Date(since))
      .map(release => ({
        id: `release-${release.tag_name}`,
        type: 'release',
        date: release.created_at,
        commit_sha: release.commit ? release.commit.id : null,
        tag_name: release.tag_name,
        branch: 'main', // GitLab releases don't specify branch
        status: 'published',
        environment: 'production'
      }));
  }

  async getTags(projectId, since) {
    const url = `${this.baseURL}/projects/${projectId}/repository/tags`;
    const headers = this.token ? { 'Private-Token': this.token } : {};

    const response = await axios.get(url, { 
      headers,
      params: { per_page: 100 }
    });

    // Filter tags by commit date (approximate)
    const tags = [];
    for (const tag of response.data.slice(0, 20)) {
      if (tag.commit && tag.commit.created_at) {
        if (new Date(tag.commit.created_at) >= new Date(since)) {
          tags.push({
            id: `tag-${tag.name}`,
            type: 'tag',
            date: tag.commit.created_at,
            commit_sha: tag.commit.id,
            tag_name: tag.name,
            branch: 'main',
            status: 'success',
            environment: 'production'
          });
        }
      }
    }

    return tags;
  }

  async getPipelines(projectId, since) {
    const url = `${this.baseURL}/projects/${projectId}/pipelines`;
    const headers = this.token ? { 'Private-Token': this.token } : {};

    const response = await axios.get(url, { 
      headers,
      params: { 
        per_page: 100,
        status: 'success',
        order_by: 'updated_at',
        sort: 'desc'
      }
    });

    return response.data
      .filter(pipeline => new Date(pipeline.created_at) >= new Date(since))
      .filter(pipeline => pipeline.ref === 'main' || pipeline.ref === 'master') // Only main branch
      .map(pipeline => ({
        id: `pipeline-${pipeline.id}`,
        type: 'pipeline',
        date: pipeline.created_at,
        commit_sha: pipeline.sha,
        tag_name: null,
        branch: pipeline.ref,
        status: pipeline.status,
        environment: pipeline.ref === 'main' ? 'production' : 'staging'
      }));
  }

  async getPullRequests(repo, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const projectId = await this.getProjectId(repo);
    
    const url = `${this.baseURL}/projects/${projectId}/merge_requests`;
    const headers = this.token ? { 'Private-Token': this.token } : {};

    const response = await axios.get(url, { 
      headers,
      params: { 
        state: 'merged',
        order_by: 'updated_at',
        sort: 'desc',
        per_page: 100
      }
    });

    const pullRequests = [];

    for (const mr of response.data) {
      // Skip if outside date range
      if (!mr.merged_at || new Date(mr.merged_at) < new Date(since)) {
        continue;
      }

      try {
        // Get commits for this MR to find first commit date
        const commitsUrl = `${this.baseURL}/projects/${projectId}/merge_requests/${mr.iid}/commits`;
        const commitsResponse = await axios.get(commitsUrl, { headers });
        
        const commits = commitsResponse.data;
        const firstCommit = commits[commits.length - 1]; // GitLab returns commits in reverse order
        const lastCommit = commits[0];

        // Get MR changes for lines added/deleted
        const changesUrl = `${this.baseURL}/projects/${projectId}/merge_requests/${mr.iid}/changes`;
        const changesResponse = await axios.get(changesUrl, { headers });
        
        let linesAdded = 0;
        let linesDeleted = 0;
        if (changesResponse.data.changes) {
          changesResponse.data.changes.forEach(change => {
            const diff = change.diff || '';
            const addedLines = (diff.match(/^\+(?!\+)/gm) || []).length;
            const deletedLines = (diff.match(/^-(?!-)/gm) || []).length;
            linesAdded += addedLines;
            linesDeleted += deletedLines;
          });
        }

        pullRequests.push({
          pr_number: mr.iid,
          pr_id: `gitlab-mr-${mr.id}`,
          title: mr.title,
          author: mr.author?.username || 'unknown',
          created_at_pr: mr.created_at,
          merged_at: mr.merged_at,
          closed_at: mr.closed_at,
          first_commit_at: firstCommit?.created_at || mr.created_at,
          last_commit_at: lastCommit?.created_at || mr.created_at,
          base_branch: mr.target_branch || 'main',
          head_branch: mr.source_branch || 'unknown',
          head_sha: mr.sha,
          merge_sha: mr.merge_commit_sha,
          state: mr.state,
          is_merged: mr.state === 'merged',
          lines_added: linesAdded,
          lines_deleted: linesDeleted,
          commits_count: commits.length
        });

        // Rate limiting protection
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.warn(`Warning: Could not fetch details for MR !${mr.iid}: ${error.message}`);
        // Add MR with basic info only
        pullRequests.push({
          pr_number: mr.iid,
          pr_id: `gitlab-mr-${mr.id}`,
          title: mr.title,
          author: mr.author?.username || 'unknown',
          created_at_pr: mr.created_at,
          merged_at: mr.merged_at,
          closed_at: mr.closed_at,
          first_commit_at: mr.created_at,
          last_commit_at: mr.created_at,
          base_branch: mr.target_branch || 'main',
          head_branch: mr.source_branch || 'unknown',
          head_sha: mr.sha,
          merge_sha: mr.merge_commit_sha,
          state: mr.state,
          is_merged: mr.state === 'merged',
          lines_added: 0,
          lines_deleted: 0,
          commits_count: 0
        });
      }
    }

    return pullRequests;
  }
}
