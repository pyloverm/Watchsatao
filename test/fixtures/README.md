# Échantillons figés

HTML réel de `recrutamento.cm-satao.pt`, capturé le 2026-09-02. Les tests
tournent sur ces fichiers, jamais sur le réseau : une source injoignable ou
refondue ne doit pas faire échouer la suite pour la mauvaise raison.

| Fichier | Origine | État attendu |
| --- | --- | --- |
| `processos-ativos-fechado.html` | `/processos-ativos`, capture brute | `Fechado` |
| `processos-a-decorrer.html` | `/processos-a-decorrer`, capture brute | `Aberto` |
| `processos-ativos-aberto.html` | assemblé : les `<li>` réels de `/processos-a-decorrer` greffés dans le squelette réel de `/processos-ativos` | `Aberto` |

Le troisième fichier est assemblé parce que `/processos-ativos` était fermée
au moment de la capture : on ne disposait d'aucun état ouvert authentique
pour *cette* URL. Le balisage des `<li>` et le squelette de page sont réels,
seuls les `href` ont été réécrits de `/processos-a-decorrer/concurso` vers
`/processos-ativos/concurso`. À remplacer par une capture authentique dès
qu'un procédimento ouvrira ses candidatures.

Les jetons `authenticity_token` ont été remplacés par une valeur fixe : ce
sont des jetons CSRF de session, sans valeur, mais inutile de committer des
chaînes qui ressemblent à des secrets.
