### About

Ultra simple minimalist HTML-JS Framework built for simple reactive applications, compiled to HTML + JS and syntactically very similiar to vanilla  HTML + JS 
To understand the syntax look at /examples

### Features

Reactive UI: simple Reactive UI specified with {...} inside of an HTML Node , no hooks or getter and setter required.
Conditional Display: Specify a nodes display condition by adding display-if attribute 

### Functionality

The compiler tracks what variables are bound to what HTML nodes and then update functions are injected , that update bound nodes content, these are called every time the variable is changed.
