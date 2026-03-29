const express = require("express");
const app = express();

// TEST ROUTE
app.get("/test-r2", (req, res) => {
  res.send("WORKING CLEAN");
});

// ROOT
app.get("/", (req, res) => {
  res.send("ROOT WORKING");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});