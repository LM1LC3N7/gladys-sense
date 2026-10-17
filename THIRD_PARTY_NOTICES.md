# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## scottbonline/sense (sense-energy)

<https://github.com/scottbonline/sense>

Ported to JavaScript in `src/sense/api.js`, `src/sense/live.js` and
`src/sense/model.js`: the endpoints of the Sense cloud API, the form-encoded
sign-in and its two-factor step (`mfa_token`, `authenticate/mfa`), the token
renewal (`renew`) and the "renew once, then retry" rule on a 401, the URL and
the frame layout of the real-time feed, the filtering of the detected devices,
the hourly breakdown of a day and the `start` parameter of the trends.

```
Copyright 2018 Scott Belisle

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
