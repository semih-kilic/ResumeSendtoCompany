# Demo guide

This guide describes a safe product walkthrough for screenshots, screen recordings, and local evaluation. Use synthetic or opted-in data only.

## Recommended walkthrough

1. Start the backend with `npm run dev` and the dashboard with `npm --prefix frontend-new run dev`.
2. Open the overview and show lead count, delivery metrics, reply rate, and provider health.
3. Open lead discovery and show a small synthetic result set with verification state and source.
4. Create a dry-run campaign and show the review step before delivery.
5. Open the personalization preview and show the generated introduction next to the company context.
6. Finish on analytics and explain how replies, bounces, and provider events are surfaced.

## Recording rules

Do not include API keys, SMTP credentials, private recipient data, uploaded resumes, or personal email addresses. A good first demo is 20–30 seconds, silent, with one clear action per screen and the dry-run state visible before any send action.

## Suggested caption

> Discover leads, verify contacts, personalize with AI, review the campaign, and measure what happens next — from one self-hosted workspace.

## Visual assets

The repository includes source-controlled SVG assets for the README and social preview:

- [`dashboard-overview.svg`](../assets/dashboard-overview.svg)
- [`outreach-workflow.svg`](../assets/outreach-workflow.svg)
- [`social-preview.svg`](../assets/social-preview.svg)
