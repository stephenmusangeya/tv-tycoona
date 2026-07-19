import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Poster } from './src/ui/Poster';
import { posterFor } from './src/ui/art';
const seed = 'after-hours-marty-vance';
console.log(JSON.stringify(posterFor(seed, 'talkshow')).slice(0, 300));
const h = renderToStaticMarkup(<Poster seed={seed} format="talkshow" title="After Hours with Marty Vance" size="lg" />);
console.log(h.slice(0, 1400));
