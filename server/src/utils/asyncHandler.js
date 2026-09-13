// Express 4 does not catch a rejected promise from an async handler: it never reaches the error
// middleware, becomes an unhandled rejection, and Node terminates the process — taking the sync
// cron and the email scheduler down with it. Verified on this stack (Express 4.22, Node 24):
// one `throw` inside an async route exited the server with code 1. A MongoDB blip long enough for
// Mongoose's 10 s buffer to give up was enough to trigger it.
//
// Every route handler is wrapped in this so a failure becomes a 500 (or a 4xx, see app.js)
// for that one request instead.
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
