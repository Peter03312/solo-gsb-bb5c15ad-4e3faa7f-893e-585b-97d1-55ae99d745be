import React from 'react';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

export default function Markdown({ source }) {
  const html = marked.parse(String(source ?? ''));
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
