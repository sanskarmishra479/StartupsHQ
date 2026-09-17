import {
  categoryMetadata,
  categoryPage,
  categoryStaticParams,
} from "../../../_lib/category-route";

// FR-108: /categories/locations/countries/[slug].

export const generateStaticParams = categoryStaticParams("countries");
export const generateMetadata = categoryMetadata("countries");
export default categoryPage("countries");
