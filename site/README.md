# ClawLab GitHub Pages Site

This folder is a static website deployed by GitHub Pages.

## Local Preview

Use any static server from the repository root:

```bash
python -m http.server 8000
```

Then open:

- http://localhost:8000/site/

## Deployment

Deployment is handled by `.github/workflows/deploy-pages.yml`.
The workflow publishes the `site/` directory to GitHub Pages.
