type Content = {
  id: string;
  text: string;
};

type Container = {
  id: string;
  left: Content[];
  right: Content & {
    children: Container[];
  };
};

type Schema = {
  version: number;
  root: Container[];
};
