System.config({
  "paths": {
    "*": "*.js",
    "github:*": "jspm_packages/github/*.js",
    "npm:*": "jspm_packages/npm/*.js"
  }
});

System.config({
  "map": {
    "q": "npm:q@^2.0.2",
    "undefined": {
      "npm:asap@1": "npm:asap@1",
      "npm:collections@^2.0.1": "npm:collections@^2.0.1",
      "github:jspm/nodelibs@0.0.3": "github:jspm/nodelibs@0.0.3",
      "npm:weak-map@^1.0.4": "npm:weak-map@^1.0.4",
      "npm:inherits@^2.0.1": "npm:inherits@^2.0.1",
      "npm:ieee754@^1.1.1": "npm:ieee754@^1.1.1",
      "npm:Base64@0.2": "npm:Base64@0.2",
      "npm:base64-js@0.0": "npm:base64-js@0.0",
      "github:systemjs/plugin-json@master": "github:systemjs/plugin-json@master"
    },
    "npm:q@2.0.2": {
      "asap": "npm:asap@1",
      "collections": "npm:collections@^2.0.1"
    },
    "npm:asap@1.0.0": {},
    "npm:collections@2.0.1": {
      "weak-map": "npm:weak-map@^1.0.4"
    },
    "npm:weak-map@1.0.5": {},
    "github:jspm/nodelibs@0.0.3": {
      "inherits": "npm:inherits@^2.0.1",
      "ieee754": "npm:ieee754@^1.1.1",
      "Base64": "npm:Base64@0.2",
      "base64-js": "npm:base64-js@0.0",
      "json": "github:systemjs/plugin-json@master"
    },
    "npm:inherits@2.0.1": {},
    "npm:Base64@0.2.1": {},
    "npm:base64-js@0.0.7": {},
    "npm:ieee754@1.1.4": {}
  }
});

System.config({
  "versions": {
    "npm:q": "2.0.2",
    "npm:asap": "1.0.0",
    "npm:collections": "2.0.1",
    "github:jspm/nodelibs": "0.0.3",
    "npm:weak-map": "1.0.5",
    "npm:inherits": "2.0.1",
    "npm:ieee754": "1.1.4",
    "npm:Base64": "0.2.1",
    "npm:base64-js": "0.0.7",
    "github:systemjs/plugin-json": "master"
  }
});

