const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`TaskFlow listening on port ${port} (${process.env.NODE_ENV || 'development'})`);
});
