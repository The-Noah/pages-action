import { getInput, setOutput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";

// TODO: Confirm types

interface Stage {
  name: string;
  started_on: null | string;
  ended_on: null | string;
  status: string;
}

interface Deployment {
  id: string;
  short_id: string;
  project_id: string;
  project_name: string;
  environment: string;
  url: string;
  created_on: string;
  modified_on: string;
  latest_stage: Stage;
  deployment_trigger: {
    type: string;
    metadata: {
      branch: string;
      commit_hash: string;
      commit_message: string;
      commit_dirty: boolean;
    };
  };
  stages: Stage[];
  build_config: {
    build_command: null | string;
    destination_dir: null | string;
    root_dir: null | string;
    web_analytics_tag: null | string;
    web_analytics_token: null | string;
    fast_builds: boolean;
  };
  env_vars: unknown;
  kv_namespaces: Record<string, { namespace_id: string }>;
  aliases: null | string[];
  is_skipped: boolean;
  production_branch: string;
}

try {
  const apiToken = getInput("apiToken", { required: true });
  const accountId = getInput("accountId", { required: true });
  const projectName = getInput("projectName", { required: true });
  const directory = getInput("directory", { required: true });
  const gitHubToken = getInput("gitHubToken", { required: true });
  const branch = getInput("branch", { required: false });

  const octokit = getOctokit(gitHubToken);

  const createPagesDeployment = async () => {
    // TODO: Replace this with an API call to wrangler so we can get back a full deployment response object
    await shellac`
    $ export CLOUDFLARE_API_TOKEN="${apiToken}"
    if ${accountId} {
      $ export CLOUDFLARE_ACCOUNT_ID="${accountId}"
    }

    $$ npx wrangler@2 pages publish "${directory}" --project-name="${projectName}" --branch="${branch}"
    `;

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const {
      result: [deployment],
    } = (await response.json()) as { result: Deployment[] };

    return deployment;
  };

  const createGitHubDeployment = async () => {
    const deployment = await octokit.rest.repos.createDeployment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.ref,
      auto_merge: false,
      // @ts-ignore
      environment: branch === "prod" ? "Production" : "Preview",
      production_environment: branch === "prod",
      description: "Cloudflare Pages",
      required_contexts: [],
    });

    if (deployment.status === 201) {
      return deployment.data;
    }
  };

  const createGitHubDeploymentStatus = async ({
    id,
    url,
  }: {
    id: number;
    url: string;
  }) => {
    await octokit.rest.repos.createDeploymentStatus({
      owner: context.repo.owner,
      repo: context.repo.repo,
      deployment_id: id,
      environment_url: url,
      log_url: `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}/${id}`,
      description: "Cloudflare Pages",
      state: "success",
    });
  };

  (async () => {
    const gitHubDeployment = await createGitHubDeployment();

    const pagesDeployment = await createPagesDeployment();

    setOutput("id", pagesDeployment.id);
    setOutput("url", pagesDeployment.url);
    setOutput("environment", pagesDeployment.environment);

    if (gitHubDeployment) {
      await createGitHubDeploymentStatus({
        id: gitHubDeployment.id,
        url: pagesDeployment.url,
      });
    }
  })();
} catch (thrown) {
  setFailed(thrown.message);
}
