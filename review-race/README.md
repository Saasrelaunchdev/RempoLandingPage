# Not the Review Race: a placeholder for its Vercel project

The Review Race lives on its own branch, `claude/dreamy-cray-95z5j1`, and is tested in its own Vercel project
(`remporacetool`, Root Directory `review-race`). The owner keeps it off `main` until they confirm the merge (CLAUDE.md,
"Owner decisions").

This folder exists so that project has nothing to fail on. Vercel builds every branch of this repository in every
project connected to it. It checks that the Root Directory exists before it runs anything else, the Ignored Build Step
included, so every commit without a `review-race/` folder failed in `remporacetool` with "The specified Root Directory
"review-race" does not exist". With this folder in place, `vercel.json` here tells Vercel not to deploy the commit at
all, and the project's Ignored Build Step would skip it anyway.

On the race's branch, `review-race/` is the race itself, with its own `vercel.json`, so that branch deploys as before.

- Don't put anything else here. The landing page's deployment leaves this folder out (`/.vercelignore`), and
  `tests/unit/owner-decisions.test.mjs` checks that it holds only these two files.
- Don't redeploy, in `remporacetool`, a deployment from a commit made before this folder came in: it fails the same
  way, whatever the settings say. Delete those deployments instead.
- When the owner confirms the merge, delete this folder first (`git rm -r review-race`), then follow CLAUDE.md.
