// The /styles gallery's stylesheet, and nothing else.
//
// A module rather than a <link> so vite bundles the token imports and
// rewrites the font URLs inside them; a bare <link rel="stylesheet"> to a
// source file ships the @import chain unresolved and the fonts 404.
//
// Deliberately not `./app.css`: this page has no app on it, and pulling
// the product stylesheet in would pull the tool behind it -- on the one
// page whose job is to load fast and be crawled.
import "./styles-page.css";
