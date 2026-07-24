grammar Formula;
formula: expr+ ;

expr: FUNCNAME '(' args? ')'         # Function
    | op=(ADD|SUB) expr              # UnarySign
    | expr '(' args? ')'             # Call
    | expr PERCENT                   # Percent
    | <assoc=right> expr CARET expr  # Pow
    | expr op=(MUL|DIV) expr         # MulDiv
    | expr op=(ADD|SUB) expr         # AddSub
    | expr AMP expr                  # Concat
    | expr op=(EQ|NEQ|LT|GT|LTE|GTE) expr  # Comparison
    | NUM                            # Number
    | BOOL                           # Boolean
    | STRING                         # Str
    | REFERENCE                      # Reference
    | FUNCNAME                        # Identifier
    | '(' expr ')'                   # Parentheses
    | '{' arrayRow (SEMI arrayRow)* '}'  # ArrayLiteral
    ;

arrayRow: expr (',' expr)* ;
args: expr (',' expr)* ;

SEMI: ';' ;

REFERENCE: QUOTED_SHEET_NAME '!' REFRANGE
         | QUOTED_SHEET_NAME '!' REF
         | SHEET_NAME '!' REFRANGE
         | SHEET_NAME '!' REF
         | REFRANGE
         | REF
         ;
fragment SHEET_NAME: [A-Za-z][A-Za-z0-9]* ;
fragment QUOTED_SHEET_NAME: '\'' (~['])+ '\'' ;
fragment COL: '$'? [A-Za-z] [A-Za-z]? [A-Za-z]? ;
fragment ROW: '$'? [1-9][0-9]* ;
REF: COL ROW ;
// Ranges may omit part of an endpoint to reference whole columns (A:A, A:C),
// whole rows (1:1, 2:5), or open-ended segments (A1:B, B2:B). These are
// resolved to concrete bounded ranges against the sheet's data extent before
// evaluation (see coordinates.resolveRange / formula.expandUnboundedRanges).
REFRANGE: REF ':' REF
        | COL ':' COL
        | ROW ':' ROW
        | REF ':' COL
        | COL ':' REF
        | REF ':' ROW
        | ROW ':' REF
        ;

BOOL: 'TRUE' | 'FALSE' | 'true' | 'false';
STRING: '"' ('""' | ~["])* '"' ;
NUM: [0-9]+('.' [0-9]+)? ([eE] [+-]? [0-9]+)? ;
FUNCNAME: [A-Za-z][A-Za-z0-9_.]* ;
WS : [ \t]+ -> skip ;

MUL: '*' ;
DIV: '/' ;
ADD: '+' ;
SUB: '-' ;
AMP: '&' ;
CARET: '^' ;
PERCENT: '%' ;
EQ: '=' ;
NEQ: '<>' ;
LTE: '<=' ;
GTE: '>=' ;
LT: '<' ;
GT: '>' ;
