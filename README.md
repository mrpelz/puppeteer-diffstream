# puppeteer-diffstream

* uses Puppeteer to render webpages (e.g. a Web-based UI)
* detects visual changes on the viewport
* calculates position/size of a bounding box including all visual changes
* optionally remaps colors to make web-UIs more usable for E-Paper displays
* sends the bounding box and its coordinates to WebSocket-clients
* reads touch input from WebSocket and injects touch events on the webpage accordingly

In essence, this is a proof of concept aiming to make UIs built using web technologies usable on small microcontrollers, which usually don't have enough oomph to do the rendering themselves.  

Runs stable over a long time, but is only meant as a starting point for further development.

I've included a JS-file implementing a bare web-client that draws the received pixels into a canvas-element and reports mouse and touch events back to the server.  
Remote browsing inside a browser, just as a demo. :D
