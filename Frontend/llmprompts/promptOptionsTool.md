Call this tool whenever the user requests to create a graph with the information from the database.
The idea is for you to return a string to create a graph that the user will afterwards use to render it as a **ECharts** graph.
Be sure that the format is always correct, like this example of what you should offer as an output, in **JSON** format (example to create a bar chart):
option = {
        title: {
          text: 'ECharts Getting Started Example'
        },
        tooltip: {},
        legend: {
          data: ['sales']
        },
        xAxis: {
          data: ['Shirts', 'Cardigans', 'Chiffons', 'Pants', 'Heels', 'Socks']
        },
        yAxis: {},
        series: [
          {
            name: 'sales',
            type: 'bar',
            data: [5, 20, 36, 10, 10, 20]
          }
        ]
      };
It is important that you always keep the 'options = ' since this is needed to work properly on the frontend and then return the associated graph. It is also ABSOLUTELY IMPORTANT that you DO NOT INCLUDE COMMENTS ON THE OUTPUT, NEITHER THE FINAL ';'.
