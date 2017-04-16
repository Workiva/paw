System.config({
  "paths": {
    "*": "*.js",
    "github:*": "jspm_packages/github/*.js",
    "npm:*": "jspm_packages/npm/*.js",
    "paw/*": "src/*.js"
  }
});

System.config({
  "map": {
    "q": "npm:q@2.0.2",
    "github:jspm/nodelibs@0.0.8": {
      "Base64": "npm:Base64@0.2.1",
      "base64-js": "npm:base64-js@0.0.8",
      "ieee754": "npm:ieee754@1.1.4",
      "inherits": "npm:inherits@2.0.1",
      "json": "github:systemjs/plugin-json@0.1.0"
    },
    "npm:collections@2.0.1": {
      "weak-map": "npm:weak-map@1.0.5"
    },
    "npm:q@2.0.2": {
      "asap": "npm:asap@1.0.0",
      "collections": "npm:collections@2.0.1"
    }
  }
});

