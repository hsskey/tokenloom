# Issue tracker: GitHub

Issues and specifications for this repository live in GitHub Issues at `hsskey/tokenloom`.
Use the `gh` CLI from this clone so it resolves the repository from `origin`.

## Conventions

- Create an issue with `gh issue create --title "..." --body-file <path>`.
- Read an issue and its discussion with `gh issue view <number> --comments`.
- List work with `gh issue list --state open --json number,title,body,labels,comments` and an appropriate label filter.
- Comment with `gh issue comment <number> --body-file <path>`.
- Change labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close resolved work with `gh issue close <number> --comment "..."`.

When a skill says to publish to the issue tracker, create a GitHub issue.
When a skill says to fetch a ticket, read the issue and comments before acting.

## Pull requests as a triage surface

PRs as a request surface: no.

External pull requests follow the repository's ordinary review process and are not treated as issue-triage requests.
GitHub shares one number sequence across issues and pull requests, so resolve an ambiguous reference before updating it.

## Setup boundary

This file configures future skill behavior.
Creating issues, labels, comments, or other remote state is outside documentation setup and requires a separate request.
